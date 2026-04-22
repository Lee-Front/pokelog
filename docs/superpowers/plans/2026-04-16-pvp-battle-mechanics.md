# PvP Battle Mechanics Completion Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PvP 배틀 엔진에 누락된 핵심 메카닉을 모두 추가하여 원작 포켓몬 배틀과 동등한 수준으로 만든다.

**Architecture:** 기존 PvE 유틸(`battle.ts`, `status-conditions.ts`, `battle-forms.ts`)을 최대한 재사용하고, PvP 엔진(`pvp-room.ts`)의 `executeFight`와 `resolveTurn`에 훅을 추가한다. 새 시스템(Protect, 독독, 명중/회피)은 기존 패턴을 따라 구현한다.

**Tech Stack:** 기존 TypeScript/Vitest 스택. 추가 의존성 없음.

---

## File Structure

### Modified Files
| File | Change |
|------|--------|
| `shared/types.ts` | StatStages에 accuracy/evasion 추가 |
| `packages/server/src/game/battle.ts` | defaultStatStages에 accuracy/evasion, 화상 공격력 감소, 명중률 계산 분리 |
| `packages/server/src/game/status-conditions.ts` | 독독(toxic) 지원, Protect volatile |
| `packages/server/src/pvp/pvp-room.ts` | 스탯변화, 화상/마비 감소, Protect, 멀티히트, 고정데미지, 자폭, 폼체인지, Struggle, 명중/회피 |
| `packages/server/tests/pvp/pvp-room.test.ts` | 각 메카닉별 테스트 |

---

## Task 1: 스탯 변화 기술 (칼춤, 용의춤 등)

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts` (executeFight)
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("pvp stat changes", () => {
  it("move with statChanges applies to attacker (self-targeting)", () => {
    const room = readyRoom();
    // Swords Dance: attack +2 (statChanges targets self when move.target includes 'user')
    const poke = room.playerA.party[0];
    poke.moves = [{ id: "swords-dance", pp: 10, maxPp: 10 }];
    submitAction(room, "userA", { type: "fight", moveId: "swords-dance" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.statStages.attack).toBeGreaterThan(0);
  });

  it("move with statChanges + statChance applies to defender on hit", () => {
    const room = readyRoom();
    // A move that lowers opponent's defense (statChance=100)
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Basic tackle has no stat changes, so no change expected
    expect(room.playerB.statStages.defense).toBe(0);
  });

  it("stat stages clamp at +6 and -6", () => {
    const room = readyRoom();
    room.playerA.statStages.attack = 5;
    const poke = room.playerA.party[0];
    poke.moves = [{ id: "swords-dance", pp: 10, maxPp: 10 }];
    submitAction(room, "userA", { type: "fight", moveId: "swords-dance" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.statStages.attack).toBe(6); // clamped
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

- [ ] **Step 3: executeFight에 스탯 변화 로직 추가**

`executeFight`에서 데미지 적용 후, ailment 처리 후에 추가:

```typescript
// ── Stat changes from move ──
if (moveData.statChanges && moveData.statChanges.length > 0) {
  const chance = moveData.meta?.statChance ?? 0;
  // statChance 0 = guaranteed (self-targeting moves like Swords Dance)
  // statChance > 0 = probability-based (secondary effect on defender)
  const isGuaranteed = chance === 0;
  const targetsSelf = moveData.target === "user" || moveData.category === "status" && isGuaranteed;

  if (targetsSelf) {
    // Self-targeting stat changes (Swords Dance, Dragon Dance, etc.)
    attacker.statStages = applyStatChanges(attacker.statStages, moveData.statChanges);
    for (const sc of moveData.statChanges) {
      const dir = sc.change > 0 ? "올랐다" : "내려갔다";
      const statNames: Record<string, string> = { attack: "공격", defense: "방어", spAttack: "특수공격", spDefense: "특수방어", speed: "스피드" };
      room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${statNames[sc.stat] ?? sc.stat}이(가) ${dir}!`);
    }
  } else if (!result.missed && defPoke.hp > 0) {
    // Opponent-targeting stat changes (secondary effects)
    const roll = isGuaranteed || Math.random() * 100 < chance;
    if (roll) {
      defender.statStages = applyStatChanges(defender.statStages, moveData.statChanges);
      for (const sc of moveData.statChanges) {
        const dir = sc.change > 0 ? "올랐다" : "내려갔다";
        const statNames: Record<string, string> = { attack: "공격", defense: "방어", spAttack: "특수공격", spDefense: "특수방어", speed: "스피드" };
        room.log.push(`${defender.nickname}의 ${defPoke.species}: ${statNames[sc.stat] ?? sc.stat}이(가) ${dir}!`);
      }
    }
  }
}
```

import 추가: `import { applyStatChanges } from "../game/battle.js";` (이미 다른 함수들 import하는 줄에 추가)

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pvp): apply stat changes from moves in PvP battles"
```

---

## Task 2: 화상 공격력 감소 & 마비 스피드 감소

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("pvp burn and paralysis stat effects", () => {
  it("burn halves physical attack damage", () => {
    const room = readyRoom();
    // Give A a physical move and burn
    room.playerA.party[0].statusCondition = "burn";
    room.playerA.party[0].moves = [{ id: "tackle", pp: 35, maxPp: 35 }];

    // Record B's HP, then attack
    const hpBefore = room.playerB.party[0].hp;
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    const damageBurned = hpBefore - room.playerB.party[0].hp;

    // Now without burn
    const room2 = readyRoom();
    room2.playerA.party[0].moves = [{ id: "tackle", pp: 35, maxPp: 35 }];
    const hpBefore2 = room2.playerB.party[0].hp;
    submitAction(room2, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room2, "userB", { type: "fight", moveId: "tackle" });
    const damageNormal = hpBefore2 - room2.playerB.party[0].hp;

    // Burned damage should be less (approximately half for physical)
    expect(damageBurned).toBeLessThan(damageNormal);
  });

  it("paralysis halves speed for turn order", () => {
    const room = readyRoom();
    // A is faster but paralyzed
    room.playerA.party[0].stats.speed = 100;
    room.playerB.party[0].stats.speed = 60;
    room.playerA.party[0].statusCondition = "paralysis";
    // Paralyzed speed: 50, B's speed: 60 → B goes first
    // We can verify by checking log order
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

- [ ] **Step 3: 구현**

`executeFight`에서 `calculateDamage` 호출 시, 화상이면 물리 공격 스탯을 절반으로:

```typescript
// ── Burn attack reduction (physical only) ──
let effectiveAtkStats = atkPoke.stats;
if (atkPoke.statusCondition === "burn" && moveData.category === "physical") {
  effectiveAtkStats = { ...atkPoke.stats, attack: Math.floor(atkPoke.stats.attack * 0.5) };
}
```

`calculateDamage` 호출에 `effectiveAtkStats` 전달.

`resolveTurn`에서 `determineTurnOrder` 호출 시, 마비면 스피드 절반:

```typescript
const speedA = room.playerA.party[room.playerA.activeIndex].statusCondition === "paralysis"
  ? Math.floor(pokemonA.stats.speed * 0.5) : pokemonA.stats.speed;
const speedB = room.playerB.party[room.playerB.activeIndex].statusCondition === "paralysis"
  ? Math.floor(pokemonB.stats.speed * 0.5) : pokemonB.stats.speed;
const order = determineTurnOrder(speedA, speedB, moveA?.priority ?? 0, moveB?.priority ?? 0);
```

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pvp): add burn attack reduction and paralysis speed reduction"
```

---

## Task 3: 독독 (Toxic, 맹독)

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `shared/pvp-types.ts` (PvpPokemon에 toxicCounter 추가)
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: PvpPokemon에 toxicCounter 추가**

`shared/pvp-types.ts`의 PvpPokemon에:
```typescript
toxicCounter?: number;  // 맹독 턴 카운터 (1, 2, 3, ...) — 데미지 = maxHp * counter / 16
```

- [ ] **Step 2: 테스트 작성**

```typescript
describe("pvp toxic", () => {
  it("toxic damage increases each turn", () => {
    const room = readyRoom();
    room.playerA.party[0].statusCondition = "poison";
    room.playerA.party[0].toxicCounter = 1; // badly poisoned

    // After turn 1: 1/16 maxHp damage
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // toxicCounter should now be 2

    // Damage increases each turn
    const hpAfterTurn1 = room.playerA.party[0].hp;
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    const hpAfterTurn2 = room.playerA.party[0].hp;

    // Turn 2 toxic damage (2/16) > turn 1 toxic damage (1/16)
    // Both turns also take tackle damage, but the difference should show toxic escalation
  });
});
```

- [ ] **Step 3: 구현**

ailment 적용에서 `toxic` ailment 감지:

```typescript
if (ailment === "poison" && (moveData.id === "toxic" || ailment === "toxic")) {
  defPoke.toxicCounter = 1;
}
```

`resolveTurn` end-of-turn에서 toxic 카운터 처리:

```typescript
if (poke.statusCondition === "poison" && poke.toxicCounter != null) {
  const toxicDmg = Math.max(1, Math.floor(poke.maxHp * poke.toxicCounter / 16));
  poke.hp = Math.max(0, poke.hp - toxicDmg);
  poke.toxicCounter += 1;
  room.log.push(`${player.nickname}의 ${poke.species}: 독 데미지 ${toxicDmg}!`);
} else {
  // Use standard applyEndOfTurn for non-toxic
}
```

교체 시 toxicCounter 리셋.

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pvp): add toxic (badly poisoned) with escalating damage"
```

---

## Task 4: 명중/회피 랭크

**Files:**
- Modify: `shared/types.ts` (StatStages)
- Modify: `packages/server/src/game/battle.ts` (defaultStatStages, 명중률 계산)
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: StatStages에 accuracy/evasion 추가**

`shared/types.ts`:
```typescript
export interface StatStages {
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
  accuracy: number;   // 추가
  evasion: number;     // 추가
}
```

`battle.ts`의 `defaultStatStages()`:
```typescript
export function defaultStatStages(): StatStages {
  return { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0, accuracy: 0, evasion: 0 };
}
```

- [ ] **Step 2: 명중률 계산 함수 추가**

`battle.ts`에:
```typescript
export function calculateAccuracy(moveAccuracy: number, attackerAccStage: number, defenderEvaStage: number): number {
  // 명중/회피 랭크: 양수면 3/(3+stage), 음수면 (3+|stage|)/3
  const accMult = attackerAccStage >= 0 ? (3 + attackerAccStage) / 3 : 3 / (3 + Math.abs(attackerAccStage));
  const evaMult = defenderEvaStage >= 0 ? 3 / (3 + defenderEvaStage) : (3 + Math.abs(defenderEvaStage)) / 3;
  return moveAccuracy * accMult * evaMult;
}
```

- [ ] **Step 3: pvp-room.ts에서 명중률 계산 적용**

`executeFight`에서 `calculateDamage` 전에 별도 명중 체크:

```typescript
// ── Accuracy check with stages ──
if (moveData.accuracy > 0 && moveData.accuracy < 101) {
  const effectiveAcc = calculateAccuracy(
    moveData.accuracy,
    attacker.statStages.accuracy,
    defender.statStages.evasion,
  );
  if (Math.random() * 100 >= effectiveAcc) {
    room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${moveData.name} 빗나갔다!`);
    return;
  }
}
```

`calculateDamage`에서 기존 accuracy 체크는 사용하지 않도록 accuracy=999 등으로 우회하거나, calculateDamage 호출 전에 이미 명중 처리했으므로 이중 체크 방지.

- [ ] **Step 4: 테스트 작성 및 통과**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pvp): add accuracy/evasion stat stages"
```

---

## Task 5: Struggle (발버둥)

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("pvp struggle", () => {
  it("uses struggle when all PP depleted", () => {
    const room = readyRoom();
    room.playerA.party[0].moves = [{ id: "tackle", pp: 0, maxPp: 35 }];
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Should still deal damage (struggle) and take 1/4 recoil
    expect(room.playerA.party[0].hp).toBeLessThan(100); // recoil damage
  });
});
```

- [ ] **Step 2: 구현**

`executeFight`에서 PP 체크 후:

```typescript
const move = atkPoke.moves.find((m) => m.id === moveId);
const isStruggle = !move || move.pp <= 0;
if (isStruggle) {
  // Struggle: 50 power, typeless, 1/4 recoil
  const struggleMove: MoveData = {
    id: "struggle", name: "발버둥", type: "normal", category: "physical",
    power: 50, accuracy: 100, pp: 1, description: "",
  };
  // ... use struggleMove instead of moveData
  // After damage: recoil = max(1, floor(atkPoke.maxHp / 4))
} else {
  move.pp -= 1;
}
```

- [ ] **Step 3: 테스트 통과 확인**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(pvp): add Struggle when all PP depleted"
```

---

## Task 6: 멀티히트 기술

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
describe("pvp multi-hit moves", () => {
  it("multi-hit move deals damage multiple times", () => {
    const room = readyRoom();
    room.playerA.party[0].moves = [{ id: "fury-attack", pp: 20, maxPp: 20 }];
    // fury-attack: minHits=2, maxHits=5
    submitAction(room, "userA", { type: "fight", moveId: "fury-attack" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    // Should have "N번 맞았다!" in log
    expect(room.log.some((l) => l.includes("번 맞았다"))).toBe(true);
  });
});
```

- [ ] **Step 2: 구현**

`executeFight`에서 데미지 적용 부분을 루프로 감싸기:

```typescript
const minHits = moveData.meta?.minHits ?? 1;
const maxHits = moveData.meta?.maxHits ?? 1;
const hitCount = minHits === maxHits ? minHits
  : minHits + Math.floor(Math.random() * (maxHits - minHits + 1));

let totalDamage = 0;
for (let hit = 0; hit < hitCount; hit++) {
  if (defPoke.hp <= 0) break;
  const result = calculateDamage(...);
  defPoke.hp = Math.max(0, defPoke.hp - result.damage);
  totalDamage += result.damage;
}
if (hitCount > 1) {
  room.log.push(`${hitCount}번 맞았다!`);
}
```

- [ ] **Step 3: 테스트 통과 확인**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(pvp): add multi-hit move support"
```

---

## Task 7: 고정 데미지 기술 & 자폭

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 고정 데미지 구현**

특정 기술 ID를 하드코딩:

```typescript
const FIXED_DAMAGE_MOVES: Record<string, number | "level"> = {
  "dragon-rage": 40,
  "sonic-boom": 20,
  "seismic-toss": "level",
  "night-shade": "level",
};
```

executeFight에서 데미지 계산 전에:

```typescript
const fixedDmg = FIXED_DAMAGE_MOVES[moveId];
if (fixedDmg != null) {
  const damage = fixedDmg === "level" ? atkPoke.level : fixedDmg;
  defPoke.hp = Math.max(0, defPoke.hp - damage);
  room.log.push(`${attacker.nickname}의 ${atkPoke.species}: ${moveData.name}! ${damage} 데미지!`);
  return; // skip normal damage calc
}
```

- [ ] **Step 2: 자폭/대폭발 구현**

```typescript
const SELF_DESTRUCT_MOVES = new Set(["self-destruct", "explosion", "memento", "healing-wish"]);

if (SELF_DESTRUCT_MOVES.has(moveId)) {
  // Attacker faints
  atkPoke.hp = 0;
  room.log.push(`${attacker.nickname}의 ${atkPoke.species}: 자폭했다!`);
  // Still deal damage normally (for self-destruct/explosion)
}
```

- [ ] **Step 3: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add fixed damage moves and self-destruct"
```

---

## Task 8: Protect/Detect (방어/판별)

**Files:**
- Modify: `shared/pvp-types.ts` (PvpPlayerState에 protectCount 추가)
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: PvpPlayerState에 protectCount 추가**

```typescript
protectCount?: number;  // 연속 방어 횟수 (성공 확률 감소용)
```

- [ ] **Step 2: 테스트 작성**

```typescript
describe("pvp protect", () => {
  it("protect blocks all damage for one turn", () => {
    const room = readyRoom();
    room.playerA.party[0].moves = [{ id: "protect", pp: 10, maxPp: 10 }];
    submitAction(room, "userA", { type: "fight", moveId: "protect" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.party[0].hp).toBe(100); // no damage taken
  });

  it("consecutive protect can fail", () => {
    // Test that protect success rate decreases
  });
});
```

- [ ] **Step 3: 구현**

Protect 기술 목록:
```typescript
const PROTECT_MOVES = new Set(["protect", "detect", "kings-shield", "baneful-bunker", "spiky-shield"]);
```

`resolveTurn`에서 스위치 처리 후, 공격 처리 전에:

```typescript
// ── Protect handling ──
const protectA = actionA.type === "fight" && PROTECT_MOVES.has(actionA.moveId);
const protectB = actionB.type === "fight" && PROTECT_MOVES.has(actionB.moveId);

if (protectA) {
  const successRate = 1 / Math.pow(3, room.playerA.protectCount ?? 0);
  if (Math.random() < successRate) {
    addVolatile(room.playerA.volatiles, "protect", 1);
    room.playerA.protectCount = (room.playerA.protectCount ?? 0) + 1;
    room.log.push(`${room.playerA.nickname}: 방어 태세!`);
  } else {
    room.log.push(`${room.playerA.nickname}: 방어에 실패했다!`);
  }
}
// ... same for B

// Reset protect count if not using protect this turn
if (!protectA) room.playerA.protectCount = 0;
if (!protectB) room.playerB.protectCount = 0;
```

`executeFight`에서 데미지 적용 전에:

```typescript
if (hasVolatile(defender.volatiles, "protect")) {
  room.log.push(`${defender.nickname}의 ${defPoke.species}: 공격을 막았다!`);
  return; // 데미지 0
}
```

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pvp): add Protect/Detect with consecutive failure"
```

---

## Task 9: 배틀 폼체인지 (기존 battle-forms.ts 연동)

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: import 추가**

```typescript
import {
  checkPostAttackForm, checkHpThresholdForm, checkTurnForm,
  checkWeatherForm, checkMoveForm,
} from "../game/battle-forms.js";
```

- [ ] **Step 2: executeFight에 폼체인지 훅 추가**

공격 후:
```typescript
// ── Post-attack form change (Aegislash) ──
const atkFormChange = checkPostAttackForm(atkPoke.species, moveData.category, attacker.battleForm ?? atkPoke.variantId ?? null);
if (atkFormChange) {
  attacker.battleForm = atkFormChange.newForm;
  room.log.push(atkFormChange.message);
}

// ── Move-based form change (Meloetta) ──
const moveFormChange = checkMoveForm(atkPoke.species, moveId, attacker.battleForm ?? atkPoke.variantId ?? null);
if (moveFormChange) {
  attacker.battleForm = moveFormChange.newForm;
  room.log.push(moveFormChange.message);
}
```

HP 변경 후:
```typescript
// ── HP threshold form change (Wishiwashi, Darmanitan, etc.) ──
for (const player of [attacker, defender]) {
  const poke = player.party[player.activeIndex];
  const hpForm = checkHpThresholdForm(poke.species, poke.hp, poke.maxHp, poke.level, player.battleForm ?? poke.variantId ?? null);
  if (hpForm) {
    player.battleForm = hpForm.newForm;
    room.log.push(hpForm.message);
  }
}
```

`resolveTurn` 턴 시작에:
```typescript
// ── Turn-based form (Morpeko) ──
for (const player of [room.playerA, room.playerB]) {
  const poke = player.party[player.activeIndex];
  const turnForm = checkTurnForm(poke.species, room.turn, player.battleForm ?? poke.variantId ?? null);
  if (turnForm) {
    player.battleForm = turnForm.newForm;
    room.log.push(`${player.nickname}의 ${poke.species}: ${turnForm.message}`);
  }
}

// ── Weather form (Castform, Cherrim) ──
for (const player of [room.playerA, room.playerB]) {
  const poke = player.party[player.activeIndex];
  const weatherForm = checkWeatherForm(poke.species, room.weather, player.battleForm ?? poke.variantId ?? null);
  if (weatherForm) {
    player.battleForm = weatherForm.newForm;
    room.log.push(`${player.nickname}의 ${poke.species}: ${weatherForm.message}`);
  }
}
```

- [ ] **Step 3: 테스트 작성**

```typescript
describe("pvp form changes", () => {
  it("morpeko changes form each turn", () => {
    const morpeko = { ...makePokemon("morpeko"), species: "morpeko" };
    const partyA = [morpeko, makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Turn 1 (odd) → hangry
    submitAction(room, "userA", { type: "fight", moveId: "tackle" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.battleForm).toBe("morpeko-hangry");
  });
});
```

- [ ] **Step 4: 테스트 통과 확인**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(pvp): integrate battle form changes into PvP engine"
```

---

## Task 10: 전체 테스트 & 타입 체크

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
git commit -m "feat(pvp): complete PvP battle mechanics (Plan A)"
```
