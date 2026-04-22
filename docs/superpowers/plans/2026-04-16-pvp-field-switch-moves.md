# PvP Field Effects & Switch Moves Implementation Plan (Plan D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엔트리 해저드(스텔스록/압정/독압정), 교체 기술(유턴/볼트체인지), 바통터치를 PvP에 추가한다.

**Architecture:** PvpPlayerState에 `hazards` 필드를 추가하고, 교체 시 해저드 데미지를 적용한다. 유턴/볼트체인지는 데미지 후 강제 교체 페이즈를 트리거한다. 바통터치는 교체 시 스탯 스테이지를 유지한다.

**Tech Stack:** 기존 TypeScript/Vitest. 추가 의존성 없음.

---

## File Structure

### Modified Files
| File | Change |
|------|--------|
| `shared/pvp-types.ts` | PvpPlayerState에 hazards 필드 추가 |
| `packages/server/src/pvp/pvp-room.ts` | 해저드 설치/데미지, 유턴/볼트체인지, 바통터치, Rapid Spin/Defog |
| `packages/server/tests/pvp/pvp-room.test.ts` | 테스트 |

---

## Task 1: 엔트리 해저드 시스템

**Files:**
- Modify: `shared/pvp-types.ts`
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: PvpPlayerState에 hazards 추가**

```typescript
hazards?: {
  stealthRock?: boolean;
  spikes?: number;       // 0-3 layers
  toxicSpikes?: number;  // 0-2 layers
  stickyWeb?: boolean;
};
```

- [ ] **Step 2: 해저드 설치 기술 처리**

executeFight에서 특정 기술 ID 감지:

```typescript
const HAZARD_MOVES: Record<string, (player: PvpPlayerState) => void> = {
  "stealth-rock": (target) => {
    if (!target.hazards) target.hazards = {};
    if (!target.hazards.stealthRock) {
      target.hazards.stealthRock = true;
    }
  },
  "spikes": (target) => {
    if (!target.hazards) target.hazards = {};
    target.hazards.spikes = Math.min(3, (target.hazards.spikes ?? 0) + 1);
  },
  "toxic-spikes": (target) => {
    if (!target.hazards) target.hazards = {};
    target.hazards.toxicSpikes = Math.min(2, (target.hazards.toxicSpikes ?? 0) + 1);
  },
  "sticky-web": (target) => {
    if (!target.hazards) target.hazards = {};
    if (!target.hazards.stickyWeb) {
      target.hazards.stickyWeb = true;
    }
  },
};

// In executeFight, after move execution:
const hazardSetup = HAZARD_MOVES[moveId];
if (hazardSetup && !result.missed) {
  hazardSetup(defender);
  room.log.push(`상대 필드에 ${moveData.name}!`);
}
```

- [ ] **Step 3: 교체 시 해저드 데미지 적용**

applySwitch에서 새 포켓몬 등장 시:

```typescript
function applyHazardDamage(room: PvpRoomState, player: PvpPlayerState, pokemon: PvpPokemon): void {
  const hazards = player.hazards;
  if (!hazards) return;
  
  // heavy-duty-boots 면역
  if (pokemon.heldItem === "heavy-duty-boots") return;

  const types = getEffectiveTypes(pokemon.species, pokemon.variantId, player.battleForm);

  // Stealth Rock: 타입 상성 기반 (1/8 기준)
  if (hazards.stealthRock) {
    const typeChart = getTypeChart();
    let mult = 1;
    for (const t of types) mult *= (typeChart["rock"]?.[t] ?? 1);
    const dmg = Math.max(1, Math.floor(pokemon.maxHp * mult / 8));
    pokemon.hp = Math.max(0, pokemon.hp - dmg);
    room.log.push(`스텔스록 데미지! ${pokemon.species}에게 ${dmg} 데미지!`);
  }

  // Spikes: 비행/부유 면역, 층수별 데미지
  if (hazards.spikes && hazards.spikes > 0) {
    const isGrounded = !types.includes("flying") && pokemon.abilityId !== "levitate";
    if (isGrounded) {
      const spikesDmg = [0, 1/8, 1/6, 1/4][hazards.spikes] ?? 0;
      const dmg = Math.max(1, Math.floor(pokemon.maxHp * spikesDmg));
      pokemon.hp = Math.max(0, pokemon.hp - dmg);
      room.log.push(`압정 데미지! ${pokemon.species}에게 ${dmg} 데미지!`);
    }
  }

  // Toxic Spikes: 비행/부유 면역, 독타입이면 제거
  if (hazards.toxicSpikes && hazards.toxicSpikes > 0) {
    const isGrounded = !types.includes("flying") && pokemon.abilityId !== "levitate";
    if (isGrounded) {
      if (types.includes("poison")) {
        // 독타입이 밟으면 제거
        hazards.toxicSpikes = 0;
        room.log.push(`${pokemon.species}이(가) 독압정을 흡수했다!`);
      } else if (!pokemon.statusCondition) {
        if (hazards.toxicSpikes >= 2) {
          pokemon.statusCondition = "poison";
          pokemon.toxicCounter = 1; // badly poisoned
          room.log.push(`${pokemon.species}: 맹독에 걸렸다!`);
        } else {
          pokemon.statusCondition = "poison";
          room.log.push(`${pokemon.species}: 독에 걸렸다!`);
        }
      }
    }
  }

  // Sticky Web: 비행/부유 면역, speed -1
  if (hazards.stickyWeb) {
    const isGrounded = !types.includes("flying") && pokemon.abilityId !== "levitate";
    if (isGrounded) {
      player.statStages = applyStatChanges(player.statStages, [{ stat: "speed", change: -1 }]);
      room.log.push(`끈적끈적네트! ${pokemon.species}의 스피드가 내려갔다!`);
    }
  }
}
```

- [ ] **Step 4: 해저드 제거 기술**

```typescript
const HAZARD_CLEAR_MOVES: Record<string, "own" | "opponent"> = {
  "rapid-spin": "own",    // 자기 쪽 해저드 제거
  "defog": "opponent",     // 양쪽 해저드 제거 (simplified: 상대 쪽만)
  "court-change": "swap",  // 해저드 스왑
};

// In executeFight:
if (moveId === "rapid-spin" && !result.missed) {
  attacker.hazards = undefined;
  room.log.push(`${attacker.nickname}: 해저드를 제거했다!`);
}
if (moveId === "defog" && !result.missed) {
  defender.hazards = undefined;
  attacker.hazards = undefined;
  room.log.push("양쪽 해저드가 제거됐다!");
}
```

- [ ] **Step 5: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add entry hazards system (stealth rock, spikes, toxic spikes, sticky web)"
```

---

## Task 2: 유턴/볼트체인지

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 교체 기술 감지**

```typescript
const SWITCH_AFTER_MOVES = new Set(["u-turn", "volt-switch", "flip-turn", "parting-shot"]);
```

- [ ] **Step 2: executeFight에서 교체 플래그 설정**

executeFight의 반환값을 변경하거나, room에 pendingSwitchAfterMove 플래그를 설정:

```typescript
// At end of executeFight, after damage:
if (SWITCH_AFTER_MOVES.has(moveId) && !result.missed && atkPoke.hp > 0) {
  // Check if attacker has alive pokemon to switch to
  const hasAlive = attacker.party.some((p, i) => i !== attacker.activeIndex && p.hp > 0);
  if (hasAlive) {
    // Set flag for resolveTurn to trigger forced switch
    if (!room.pendingSwitchAfterMove) room.pendingSwitchAfterMove = {};
    const side = room.playerA === attacker ? "a" : "b";
    room.pendingSwitchAfterMove[side] = true;
  }
}
```

PvpRoomState에 `pendingSwitchAfterMove?: { a?: boolean; b?: boolean }` 추가.

- [ ] **Step 3: resolveTurn에서 교체 페이즈**

공격 해결 후, KO 체크 전에:

```typescript
if (room.pendingSwitchAfterMove) {
  // Trigger forced_switch for the attacker who used u-turn/volt-switch
  room.phase = "forced_switch";
  room.forcedSwitchNeeded = {
    a: room.pendingSwitchAfterMove.a ?? false,
    b: room.pendingSwitchAfterMove.b ?? false,
  };
  room.pendingSwitchAfterMove = undefined;
  // Don't increment turn yet — wait for switch selection
  return;
}
```

- [ ] **Step 4: parting-shot 특수 처리**

parting-shot은 상대 attack/spAttack -1 후 교체:
```typescript
if (moveId === "parting-shot" && !result.missed) {
  defender.statStages = applyStatChanges(defender.statStages, [
    { stat: "attack", change: -1 }, { stat: "spAttack", change: -1 }
  ]);
  room.log.push(`${defender.nickname}의 공격과 특수공격이 내려갔다!`);
}
```

- [ ] **Step 5: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add U-turn, Volt Switch, and Flip Turn"
```

---

## Task 3: 바통터치

**Files:**
- Modify: `packages/server/src/pvp/pvp-room.ts`
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`

- [ ] **Step 1: 바통터치 감지**

```typescript
if (moveId === "baton-pass" && atkPoke.hp > 0) {
  // Set baton pass flag — keep stat stages on switch
  const hasAlive = attacker.party.some((p, i) => i !== attacker.activeIndex && p.hp > 0);
  if (hasAlive) {
    if (!room.pendingSwitchAfterMove) room.pendingSwitchAfterMove = {};
    const side = room.playerA === attacker ? "a" : "b";
    room.pendingSwitchAfterMove[side] = true;
    room.batonPass = room.batonPass || {};
    room.batonPass[side] = true;
  }
}
```

PvpRoomState에 `batonPass?: { a?: boolean; b?: boolean }` 추가.

- [ ] **Step 2: applySwitch에서 바통터치 처리**

```typescript
// In applySwitch:
const isBatonPass = room.batonPass?.a && room.playerA === player || room.batonPass?.b && room.playerB === player;
if (!isBatonPass) {
  player.statStages = defaultStatStages();
  player.volatiles = [];
}
// Clear baton pass flag
if (room.batonPass) {
  const side = room.playerA === player ? "a" : "b";
  delete room.batonPass[side];
}
```

- [ ] **Step 3: 테스트 & Commit**

```bash
git commit -m "feat(pvp): add Baton Pass (stat stage transfer on switch)"
```

---

## Task 4: 전체 테스트 & 타입 체크

- [ ] **Step 1: 전체 서버 테스트**

```bash
cd packages/server && npx vitest run
```

- [ ] **Step 2: 타입 체크**

```bash
cd packages/server && npx tsc --noEmit
cd ../cli && npx tsc --noEmit
```

- [ ] **Step 3: Commit (if needed)**

```bash
git commit -m "feat(pvp): complete field effects and switch moves (Plan D)"
```
