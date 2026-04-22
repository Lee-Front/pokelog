# PvP Battle Transformations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PvE에 이미 구현된 메가진화/기가맥스/원시회귀를 PvP 배틀 엔진에 통합한다.

**Architecture:** PvP 타입에 변신 관련 필드를 추가하고, 방 생성 시 OwnedPokemon에서 변신 데이터(heldItem, hasGigantamaxFactor, 변신 후 스탯)를 미리 계산하여 PvpPokemon에 저장한다. pvp-room.ts의 executeFight에서 fight 액션의 mega/gigantamax 플래그를 처리하고, 원시회귀는 리드 선택 시 자동 발동한다. 기가맥스는 3턴 후 자동 복귀.

**Design Decisions:**
- 원시회귀는 `transformationUsed`를 소모하지 않음 (원작과 동일 — 원시회귀 + 메가진화 동시 가능)
- 메가진화는 교체해도 메가 상태 유지 (원작과 동일 — 복귀 후 다시 메가 상태로 출전)
- 기가맥스 카운트다운은 KO 체크 전에 처리 (기가맥스 해제로 HP 0 → forced_switch/finish 트리거)
- 기절 상태에서 기가맥스 해제 시 HP 0 유지 (부활 방지)

**Tech Stack:** 기존 battle-transformations.ts, pokemon-stats.ts 유틸 재사용. 추가 의존성 없음.

---

## File Structure

### Modified Files
| File | Change |
|------|--------|
| `shared/pvp-types.ts` | PvpPokemon에 heldItem/hasGigantamaxFactor/megaForm/gmaxForm 추가, PvpPlayerState에 변신 추적 필드, PvpAction fight에 mega/gigantamax 플래그 |
| `packages/server/src/pvp/pvp-socket.ts` | userPartyToPvp에서 변신 데이터 미리 계산, 유저 인벤토리에서 keyStone/dynamaxBand 확인 |
| `packages/server/src/pvp/pvp-room.ts` | selectLead에 원시회귀 자동 발동, executeFight에 메가/기가맥스 처리, 턴 종료 시 기가맥스 카운트다운 |
| `packages/server/src/pvp/pvp-ai.ts` | AI가 메가진화/기가맥스 사용 판단 |
| `packages/server/tests/pvp/pvp-room.test.ts` | 변신 관련 테스트 추가 |
| `packages/cli/src/commands/pvp.ts` | 배틀 메뉴에 메가진화/기가맥스 옵션 추가 |

---

## Task 1: PvP 타입 확장

**Files:**
- Modify: `shared/pvp-types.ts`

- [ ] **Step 1: PvpPokemon에 변신 관련 필드 추가**

`shared/pvp-types.ts`의 PvpPokemon 인터페이스 끝에 추가:

```typescript
  heldItem?: string | null;
  hasGigantamaxFactor?: boolean;
  // 방 생성 시 미리 계산된 변신 스탯 (IVs/EVs 없이는 런타임 재계산 불가)
  megaForm?: { variantId: string; maxHp: number; stats: PokemonStats } | null;
  gmaxForm?: { variantId: string; maxHp: number; stats: PokemonStats } | null;
  primalForm?: { variantId: string; maxHp: number; stats: PokemonStats } | null;
```

- [ ] **Step 2: PvpPlayerState에 변신 추적 필드 추가**

PvpPlayerState에 추가:

```typescript
  transformationUsed?: boolean;       // 이번 배틀에서 변신 사용 여부 (1회 제한)
  transformationType?: "mega" | "gigantamax" | "primal" | null;
  gmaxTurnsRemaining?: number;        // 기가맥스 남은 턴 수
  preTransformMaxHp?: number;         // 기가맥스 복귀용 원래 maxHp
  hasKeyStone?: boolean;              // 키스톤 보유 여부
  hasDynamaxBand?: boolean;           // 다이맥스밴드 보유 여부
```

- [ ] **Step 3: PvpAction fight 타입에 변신 플래그 추가**

```typescript
export type PvpAction =
  | { type: "fight"; moveId: string; mega?: boolean; gigantamax?: boolean }
  | { type: "switch"; pokemonIndex: number }
  | { type: "forfeit" };
```

- [ ] **Step 4: Commit**

```bash
git add shared/pvp-types.ts
git commit -m "feat(pvp): add transformation fields to PvP types"
```

---

## Task 2: 방 생성 시 변신 데이터 미리 계산

**Files:**
- Modify: `packages/server/src/pvp/pvp-socket.ts`

- [ ] **Step 1: userPartyToPvp에 변신 데이터 추가**

`pvp-socket.ts`에 import 추가:

```typescript
import { getMegaVariantForItem, checkPrimalReversion } from "../game/battle-transformations.js";
import { buildStatsForPokemon } from "../game/pokemon-stats.js";
import { applyGmaxHp } from "../game/battle-transformations.js";
import { getVariants } from "../game/data-loader.js";
```

`userPartyToPvp` 함수를 `userPartyToPvp(user, inventory)` 로 시그니처 변경. 두 번째 인자는 `Record<string, number>`.

각 포켓몬 변환 시 다음 필드 추가:

```typescript
heldItem: p.heldItem ?? null,
hasGigantamaxFactor: p.hasGigantamaxFactor ?? false,
megaForm: (() => {
  if (!p.heldItem) return null;
  // Rayquaza special case
  if (p.species === "rayquaza" && p.moves.some((m) => m.id === "dragon-ascent")) {
    const s = buildStatsForPokemon(p, "rayquaza-mega");
    return { variantId: "rayquaza-mega", maxHp: s.maxHp, stats: s.stats };
  }
  const variantId = getMegaVariantForItem(p.species, p.heldItem);
  if (!variantId) return null;
  const s = buildStatsForPokemon(p, variantId);
  return { variantId, maxHp: s.maxHp, stats: s.stats };
})(),
gmaxForm: (() => {
  if (!p.hasGigantamaxFactor) return null;
  const variantPrefix = p.variantId ?? p.species;
  const gmaxVariantId = `${variantPrefix}-gmax`;
  const variant = getVariants().find((v) => v.id === gmaxVariantId && v.category === "gigantamax");
  if (!variant) return null;
  const s = buildStatsForPokemon(p, gmaxVariantId);
  const gmaxHp = applyGmaxHp(s.maxHp, s.maxHp);
  return { variantId: gmaxVariantId, maxHp: gmaxHp.maxHp, stats: s.stats };
})(),
primalForm: (() => {
  const primalId = checkPrimalReversion(p as any);
  if (!primalId) return null;
  const s = buildStatsForPokemon(p, primalId);
  return { variantId: primalId, maxHp: s.maxHp, stats: s.stats };
})(),
```

- [ ] **Step 2: createRoom 호출부에 인벤토리 전달**

`userPartyToPvp` 시그니처를 변경:

```typescript
function userPartyToPvp(user: { pokemon: OwnedPokemon[]; party: string[]; inventory?: Record<string, number> }): { party: PvpPokemon[]; hasKeyStone: boolean; hasDynamaxBand: boolean }
```

반환값에 `hasKeyStone`과 `hasDynamaxBand` 추가:

```typescript
const hasKeyStone = (user.inventory?.["key-stone"] ?? 0) > 0;
const hasDynamaxBand = (user.inventory?.["dynamax-band"] ?? 0) > 0;
return { party: unique.map(...), hasKeyStone, hasDynamaxBand };
```

`pvp-room.ts`의 `makePlayer` 함수도 업데이트:

```typescript
function makePlayer(
  userId: string, nickname: string, party: PvpPokemon[],
  hasKeyStone = false, hasDynamaxBand = false,
): PvpPlayerState {
  return {
    userId, nickname, party,
    activeIndex: 0,
    statStages: defaultStatStages(),
    volatiles: [],
    ready: false,
    actionSubmitted: false,
    hasKeyStone,
    hasDynamaxBand,
    transformationUsed: false,
  };
}
```

`createRoom`도 `hasKeyStone`/`hasDynamaxBand` 받도록:

```typescript
export function createRoom(
  userIdA: string, nickA: string, partyA: PvpPokemon[],
  userIdB: string, nickB: string, partyB: PvpPokemon[],
  isAi = false,
  keysA = { hasKeyStone: false, hasDynamaxBand: false },
  keysB = { hasKeyStone: false, hasDynamaxBand: false },
): PvpRoomState {
```

`pvp-socket.ts`의 **5곳** 호출부 모두 업데이트:

```typescript
// 1. 랜덤 매칭 (line ~121-122)
const dataA = userPartyToPvp(userA);
const dataB = userPartyToPvp(userB);
const room = createRoom(
  a.userId, a.nickname, dataA.party,
  b.userId, b.nickname, dataB.party,
  false,
  { hasKeyStone: dataA.hasKeyStone, hasDynamaxBand: dataA.hasDynamaxBand },
  { hasKeyStone: dataB.hasKeyStone, hasDynamaxBand: dataB.hasDynamaxBand },
);

// 2. 방 생성 (line ~153)
const dataA = userPartyToPvp(user);
const room = createRoom(
  state.userId, user.account.nickname, dataA.party,
  "__waiting__", "대기 중...", [],
  false, { hasKeyStone: dataA.hasKeyStone, hasDynamaxBand: dataA.hasDynamaxBand },
);

// 3. 방 참가 (line ~177) — playerB 직접 갱신
const dataB = userPartyToPvp(user);
room.playerB.party = dataB.party;
room.playerB.hasKeyStone = dataB.hasKeyStone;
room.playerB.hasDynamaxBand = dataB.hasDynamaxBand;

// 4-5. AI 대전 (line ~195-206)
const data = userPartyToPvp(user);
const myParty = data.party;
// AI 파티 deep copy
const aiParty = myParty.map((p) => ({ ...p, uid: "ai-" + p.uid, stats: { ...p.stats }, moves: p.moves.map((m) => ({ ...m })), megaForm: p.megaForm ? { ...p.megaForm, stats: { ...p.megaForm.stats } } : null, gmaxForm: p.gmaxForm ? { ...p.gmaxForm, stats: { ...p.gmaxForm.stats } } : null, primalForm: p.primalForm ? { ...p.primalForm, stats: { ...p.primalForm.stats } } : null }));
const room = createRoom(
  state.userId, user.account.nickname, myParty,
  "__ai__", "AI 트레이너", aiParty, true,
  { hasKeyStone: data.hasKeyStone, hasDynamaxBand: data.hasDynamaxBand },
  { hasKeyStone: data.hasKeyStone, hasDynamaxBand: data.hasDynamaxBand },
);
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pvp/pvp-socket.ts
git commit -m "feat(pvp): pre-compute transformation data at room creation"
```

---

## Task 3: 원시회귀 — 리드 선택 시 자동 발동 (TDD)

**Files:**
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`
- Modify: `packages/server/src/pvp/pvp-room.ts`

- [ ] **Step 1: 원시회귀 테스트 작성**

`pvp-room.test.ts`에 추가:

```typescript
describe("pvp primal reversion", () => {
  function makePrimalGroudon(): PvpPokemon {
    return {
      uid: "groudon-uid", species: "groudon", level: 50,
      hp: 150, maxHp: 150,
      stats: { attack: 100, defense: 90, spAttack: 80, spDefense: 70, speed: 60 },
      moves: [{ id: "earthquake", pp: 10, maxPp: 10 }],
      statusCondition: null,
      heldItem: "red-orb",
      primalForm: { variantId: "groudon-primal", maxHp: 170, stats: { attack: 120, defense: 90, spAttack: 100, spDefense: 70, speed: 60 } },
    };
  }

  it("groudon with red-orb auto-triggers primal reversion on lead select", () => {
    const partyA = [makePrimalGroudon(), makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    expect(room.playerA.battleForm).toBe("groudon-primal");
    expect(room.playerA.transformationType).toBe("primal");
    expect(room.playerA.transformationUsed).toBeFalsy(); // 원시회귀는 슬롯 미소모
    expect(room.playerA.party[0].stats.attack).toBe(120);
    expect(room.playerA.party[0].maxHp).toBe(170);
    expect(room.playerA.party[0].hp).toBe(170); // 풀HP에서 시작
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

Expected: FAIL

- [ ] **Step 3: selectLead에 원시회귀 로직 추가**

`pvp-room.ts`의 `selectLead` 함수에서, 양쪽 모두 ready 되어 phase가 action으로 전환된 직후:

```typescript
// Apply primal reversion if applicable
for (const player of [room.playerA, room.playerB]) {
  const poke = player.party[player.activeIndex];
  if (poke.primalForm) {
    player.battleForm = poke.primalForm.variantId;
    player.transformationType = "primal";
    // 원시회귀는 transformationUsed를 소모하지 않음 (메가진화와 별개)
    poke.stats = { ...poke.primalForm.stats };
    const hpRatio = poke.hp / poke.maxHp;
    poke.maxHp = poke.primalForm.maxHp;
    poke.hp = Math.round(hpRatio * poke.maxHp);
    room.log.push(`${player.nickname}의 ${poke.species}: 원시회귀!`);
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pvp/pvp-room.ts packages/server/tests/pvp/pvp-room.test.ts
git commit -m "feat(pvp): add primal reversion on lead selection"
```

---

## Task 4: 메가진화 (TDD)

**Files:**
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`
- Modify: `packages/server/src/pvp/pvp-room.ts`

- [ ] **Step 1: 메가진화 테스트 작성**

```typescript
describe("pvp mega evolution", () => {
  function makeMegaCharizard(): PvpPokemon {
    return {
      uid: "charizard-uid", species: "charizard", level: 50,
      hp: 130, maxHp: 130,
      stats: { attack: 84, defense: 78, spAttack: 109, spDefense: 85, speed: 100 },
      moves: [{ id: "flamethrower", pp: 15, maxPp: 15 }],
      statusCondition: null,
      heldItem: "charizardite-y",
      megaForm: {
        variantId: "charizard-mega-y",
        maxHp: 130,
        stats: { attack: 84, defense: 78, spAttack: 139, spDefense: 115, speed: 100 },
      },
    };
  }

  it("fight with mega:true triggers mega evolution", () => {
    const partyA = [makeMegaCharizard(), makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasKeyStone = true;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBe("charizard-mega-y");
    expect(room.playerA.transformationType).toBe("mega");
    expect(room.playerA.transformationUsed).toBe(true);
    expect(room.playerA.party[0].stats.spAttack).toBe(139);
  });

  it("cannot mega evolve twice in one battle", () => {
    const partyA = [makeMegaCharizard(), makePokemon("pikachu")];
    partyA[1] = { ...partyA[1], heldItem: "pikachunite", megaForm: null }; // no mega form
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasKeyStone = true;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // First mega
    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationUsed).toBe(true);

    // Switch out
    submitAction(room, "userA", { type: "switch", pokemonIndex: 1 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // 교체 시 battleForm 리셋되지만, 메가진화 포켓몬 복귀 시 자동 재적용
    expect(room.playerA.battleForm).toBeUndefined(); // 현재 피카츄
    expect(room.playerA.transformationUsed).toBe(true);

    // Switch back to mega charizard — mega form should auto-restore
    submitAction(room, "userA", { type: "switch", pokemonIndex: 0 });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.battleForm).toBe("charizard-mega-y");
    expect(room.playerA.party[0].stats.spAttack).toBe(139);
  });

  it("cannot mega evolve without key stone", () => {
    const partyA = [makeMegaCharizard(), makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasKeyStone = false;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", mega: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    // Mega should not trigger, but fight still executes
    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.transformationUsed).toBeFalsy();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

- [ ] **Step 3: executeFight에 메가진화 로직 추가**

`pvp-room.ts`의 `executeFight` 시그니처에 `action: PvpAction & { type: "fight" }` 추가 (mega 플래그 접근용). 또는 별도 파라미터 `mega?: boolean`.

executeFight 함수 시작 부분, PP 소모 전에 추가:

```typescript
// ── Mega evolution ──
if (mega && !attacker.transformationUsed && attacker.hasKeyStone) {
  const poke = attacker.party[attacker.activeIndex];
  if (poke.megaForm) {
    attacker.battleForm = poke.megaForm.variantId;
    attacker.transformationType = "mega";
    attacker.transformationUsed = true;
    poke.stats = { ...poke.megaForm.stats };
    const hpRatio = poke.hp / poke.maxHp;
    poke.maxHp = poke.megaForm.maxHp;
    poke.hp = Math.round(hpRatio * poke.maxHp);
    room.log.push(`${attacker.nickname}의 ${poke.species}: 메가진화!`);
  }
}
```

executeFight 호출부 **4곳 모두** 업데이트 (resolveTurn 내):

```typescript
// 양쪽 모두 fight인 경우 (speed 순서대로)
executeFight(room, first.player, first.action.moveId, first.opp, first.action.mega);
// second도 동일
executeFight(room, second.player, second.action.moveId, second.opp, second.action.mega);

// A만 fight인 경우
executeFight(room, room.playerA, actionA.moveId, room.playerB, actionA.mega);
// B만 fight인 경우
executeFight(room, room.playerB, actionB.moveId, room.playerA, actionB.mega);
```

`applySwitch`에 메가진화 복귀 로직 추가 — 교체로 돌아온 포켓몬이 메가폼이면 자동 재적용:

```typescript
function applySwitch(room: PvpRoomState, player: PvpPlayerState, index: number): void {
  // ... existing validation ...
  player.activeIndex = index;
  player.statStages = defaultStatStages();
  player.volatiles = [];
  player.battleForm = undefined;

  // 메가진화 복귀: 해당 포켓몬이 이미 메가진화한 적 있으면 폼 재적용
  const poke = player.party[index];
  if (poke.megaForm && player.transformationUsed && player.transformationType === "mega") {
    // 이전에 메가진화한 포켓몬인지 확인 (variantId 대조)
    // 메가 스탯은 이미 적용되어 있으므로 battleForm만 복원
    player.battleForm = poke.megaForm.variantId;
  }

  room.log.push(`${player.nickname}: ${poke.species}(으)로 교체!`);
}
```

Rayquaza 특수 케이스: megaForm이 있고 key stone 불필요. 이를 위해 조건을 수정:

```typescript
if (mega && !attacker.transformationUsed) {
  const poke = attacker.party[attacker.activeIndex];
  if (poke.megaForm) {
    // Rayquaza: key stone 불필요
    const needsKeyStone = poke.species !== "rayquaza";
    if (!needsKeyStone || attacker.hasKeyStone) {
      // apply transformation...
    }
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pvp/pvp-room.ts packages/server/tests/pvp/pvp-room.test.ts
git commit -m "feat(pvp): add mega evolution to PvP battles"
```

---

## Task 5: 기가맥스 (TDD)

**Files:**
- Modify: `packages/server/tests/pvp/pvp-room.test.ts`
- Modify: `packages/server/src/pvp/pvp-room.ts`

- [ ] **Step 1: 기가맥스 테스트 작성**

```typescript
describe("pvp gigantamax", () => {
  function makeGmaxPokemon(): PvpPokemon {
    return {
      uid: "charizard-gmax-uid", species: "charizard", level: 50,
      hp: 130, maxHp: 130,
      stats: { attack: 84, defense: 78, spAttack: 109, spDefense: 85, speed: 100 },
      moves: [{ id: "flamethrower", pp: 15, maxPp: 15 }],
      statusCondition: null,
      hasGigantamaxFactor: true,
      gmaxForm: {
        variantId: "charizard-gmax",
        maxHp: 195, // ceil(130 * 1.5)
        stats: { attack: 84, defense: 78, spAttack: 109, spDefense: 85, speed: 100 },
      },
    };
  }

  it("fight with gigantamax:true triggers gigantamax with HP boost", () => {
    const gmaxPoke = makeGmaxPokemon();
    const partyA = [gmaxPoke, makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasDynamaxBand = true;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBe("charizard-gmax");
    expect(room.playerA.transformationType).toBe("gigantamax");
    expect(room.playerA.gmaxTurnsRemaining).toBe(2); // 3턴 중 1턴 사용
    expect(room.playerA.party[0].maxHp).toBe(195);
  });

  it("gigantamax auto-reverts after 3 turns", () => {
    const gmaxPoke = makeGmaxPokemon();
    const partyA = [gmaxPoke, makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasDynamaxBand = true;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Turn 1: gigantamax
    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.gmaxTurnsRemaining).toBe(2);

    // Turn 2
    submitAction(room, "userA", { type: "fight", moveId: "flamethrower" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.gmaxTurnsRemaining).toBe(1);

    // Turn 3: auto-revert
    submitAction(room, "userA", { type: "fight", moveId: "flamethrower" });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationType).toBeNull();
    expect(room.playerA.battleForm).toBeUndefined();
    expect(room.playerA.party[0].maxHp).toBe(130); // reverted
  });

  it("cannot gigantamax without dynamax band", () => {
    const gmaxPoke = makeGmaxPokemon();
    const partyA = [gmaxPoke, makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasDynamaxBand = false;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });

    expect(room.playerA.battleForm).toBeUndefined();
  });

  it("mega and gigantamax are mutually exclusive per battle", () => {
    const gmaxPoke = makeGmaxPokemon();
    gmaxPoke.megaForm = null;
    const partyA = [gmaxPoke, makePokemon("pikachu")];
    const room = createRoom("userA", "A", partyA, "userB", "B", partyB);
    room.playerA.hasDynamaxBand = true;
    selectLead(room, "userA", 0);
    selectLead(room, "userB", 0);

    // Use gigantamax
    submitAction(room, "userA", { type: "fight", moveId: "flamethrower", gigantamax: true });
    submitAction(room, "userB", { type: "fight", moveId: "tackle" });
    expect(room.playerA.transformationUsed).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

- [ ] **Step 3: executeFight에 기가맥스 로직 추가**

executeFight에 `gigantamax?: boolean` 파라미터 추가. 메가진화 블록 바로 뒤에:

```typescript
// ── Gigantamax ──
if (gigantamax && !attacker.transformationUsed && attacker.hasDynamaxBand) {
  const poke = attacker.party[attacker.activeIndex];
  if (poke.gmaxForm) {
    attacker.battleForm = poke.gmaxForm.variantId;
    attacker.transformationType = "gigantamax";
    attacker.transformationUsed = true;
    attacker.gmaxTurnsRemaining = 3;
    attacker.preTransformMaxHp = poke.maxHp;
    poke.stats = { ...poke.gmaxForm.stats };
    // HP 비례 증가
    const hpRatio = poke.hp / poke.maxHp;
    poke.maxHp = poke.gmaxForm.maxHp;
    poke.hp = Math.ceil(hpRatio * poke.maxHp);
    room.log.push(`${attacker.nickname}의 ${poke.species}: 기가맥스!`);
  }
}
```

기가맥스 카운트다운은 **KO 체크 전에** 배치 (기가맥스 해제로 HP 0 시 forced_switch/finish 트리거 필요):

resolveTurn에서 end-of-turn effects 후, 날씨 후, **KO 체크 전에** 추가:

```typescript
// ── Gigantamax countdown (BEFORE KO check) ──
for (const player of [room.playerA, room.playerB]) {
  if (player.transformationType === "gigantamax" && player.gmaxTurnsRemaining != null) {
    player.gmaxTurnsRemaining -= 1;
    if (player.gmaxTurnsRemaining <= 0) {
      const poke = player.party[player.activeIndex];
      if (player.preTransformMaxHp != null && poke.hp > 0) {
        // 생존 중일 때만 HP 비례 조정
        const hpRatio = poke.hp / poke.maxHp;
        poke.maxHp = player.preTransformMaxHp;
        poke.hp = Math.max(1, Math.floor(hpRatio * poke.maxHp));
      } else if (player.preTransformMaxHp != null && poke.hp <= 0) {
        // 기절 상태면 maxHp만 복원, hp는 0 유지 (부활 방지)
        poke.maxHp = player.preTransformMaxHp;
      }
      player.battleForm = undefined;
      player.transformationType = null;
      player.gmaxTurnsRemaining = undefined;
      player.preTransformMaxHp = undefined;
      if (poke.hp > 0) {
        room.log.push(`${player.nickname}의 ${poke.species}: 기가맥스가 풀렸다!`);
      }
    }
  }
}
```

executeFight 호출부 **4곳 모두** gigantamax도 전달:

```typescript
// 양쪽 모두 fight
executeFight(room, first.player, first.action.moveId, first.opp, first.action.mega, first.action.gigantamax);
executeFight(room, second.player, second.action.moveId, second.opp, second.action.mega, second.action.gigantamax);
// A만 fight
executeFight(room, room.playerA, actionA.moveId, room.playerB, actionA.mega, actionA.gigantamax);
// B만 fight
executeFight(room, room.playerB, actionB.moveId, room.playerA, actionB.mega, actionB.gigantamax);
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-room.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pvp/pvp-room.ts packages/server/tests/pvp/pvp-room.test.ts
git commit -m "feat(pvp): add gigantamax with 3-turn countdown to PvP battles"
```

---

## Task 6: AI 변신 판단

**Files:**
- Modify: `packages/server/src/pvp/pvp-ai.ts`
- Modify: `packages/server/tests/pvp/pvp-ai.test.ts`

- [ ] **Step 1: AI 변신 테스트 작성**

`pvp-ai.test.ts`에 추가:

```typescript
it("AI uses mega evolution when available and not used", () => {
  const megaPoke = makePoke("charizard", 100, ["flamethrower"]);
  megaPoke.megaForm = { variantId: "charizard-mega-y", maxHp: 130, stats: megaPoke.stats };
  const aiState = makeState([megaPoke]);
  aiState.hasKeyStone = true;
  aiState.transformationUsed = false;
  const opp = makeState([makePoke("bulbasaur")]);

  const action = chooseAiAction(aiState, opp);
  expect(action.type).toBe("fight");
  if (action.type === "fight") {
    expect(action.mega).toBe(true);
  }
});

it("AI does not mega evolve if already used", () => {
  const megaPoke = makePoke("charizard", 100, ["flamethrower"]);
  megaPoke.megaForm = { variantId: "charizard-mega-y", maxHp: 130, stats: megaPoke.stats };
  const aiState = makeState([megaPoke]);
  aiState.hasKeyStone = true;
  aiState.transformationUsed = true;
  const opp = makeState([makePoke("bulbasaur")]);

  const action = chooseAiAction(aiState, opp);
  if (action.type === "fight") {
    expect(action.mega).toBeFalsy();
  }
});
```

- [ ] **Step 2: AI 로직에 변신 판단 추가**

`pvp-ai.ts`의 `chooseAiAction` 함수에서, fight를 반환하기 직전에:

```typescript
const canMega = !ai.transformationUsed && ai.hasKeyStone && myPoke.megaForm != null;
const canGmax = !ai.transformationUsed && ai.hasDynamaxBand && myPoke.gmaxForm != null;

// 첫 턴에 변신 사용 (전략: 가능하면 즉시 사용)
if (canMega) {
  return { type: "fight", moveId: scored[0].moveId, mega: true };
}
if (canGmax) {
  return { type: "fight", moveId: scored[0].moveId, gigantamax: true };
}

return { type: "fight", moveId: scored[0].moveId };
```

- [ ] **Step 3: 테스트 실행 — 통과 확인**

```bash
cd packages/server && npx vitest run tests/pvp/pvp-ai.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/pvp/pvp-ai.ts packages/server/tests/pvp/pvp-ai.test.ts
git commit -m "feat(pvp): AI uses mega evolution and gigantamax"
```

---

## Task 7: CLI 배틀 메뉴에 변신 옵션 추가

**Files:**
- Modify: `packages/cli/src/commands/pvp.ts`

- [ ] **Step 1: handleBattleTurn 메뉴에 메가진화/기가맥스 옵션 추가**

`handleBattleTurn`에서 메뉴 아이템을 동적으로 구성:

```typescript
const my = state.me.party[state.me.activeIndex];
const canMega = !state.me.transformationUsed && state.me.hasKeyStone && my.megaForm != null;
const canGmax = !state.me.transformationUsed && state.me.hasDynamaxBand && my.gmaxForm != null;

const menuItems: { label: string; value: string }[] = [
  { label: "싸운다", value: "fight" },
];
if (canMega) menuItems.push({ label: "메가진화 + 싸운다", value: "mega" });
if (canGmax) menuItems.push({ label: "기가맥스 + 싸운다", value: "gmax" });
menuItems.push({ label: "교체", value: "switch" });
menuItems.push({ label: "기권", value: "forfeit" });
```

Enter 선택 분기:

```typescript
const selected = menuItems[cursor].value;
if (selected === "fight" || selected === "mega" || selected === "gmax") {
  const moveAction = await selectMove(state, my, opp);
  if (moveAction && moveAction.type === "fight") {
    if (selected === "mega") moveAction.mega = true;
    if (selected === "gmax") moveAction.gigantamax = true;
    socket.emit("pvp:action", { action: moveAction });
    // ... wait message
    return;
  }
  // cancelled
} else if (selected === "switch") {
  // ... existing switch logic
} else if (selected === "forfeit") {
  // ... existing forfeit logic
}
```

- [ ] **Step 2: buildBattleLines 시그니처 변경 및 변신 상태 표시**

`buildBattleLines`의 `menuItems` 타입을 `{ label: string; value: string }[]`로 변경:

```typescript
function buildBattleLines(
  state: PvpClientRoomView,
  my: PvpPokemon,
  opp: PvpPokemon,
  menuItems: { label: string; value: string }[],
  cursor: number,
): string[] {
```

포켓몬 이름에 변신 상태 표시:

```typescript
const myLabel = state.me.transformationType === "mega" ? `${GRN}${my.species}${R} ${YEL}[MEGA]${R}`
  : state.me.transformationType === "gigantamax" ? `${GRN}${my.species}${R} ${YEL}[GMAX ${state.me.gmaxTurnsRemaining}T]${R}`
  : state.me.transformationType === "primal" ? `${GRN}${my.species}${R} ${YEL}[PRIMAL]${R}`
  : `${GRN}${my.species}${R}`;

const oppTrans = state.opponent.transformationType;
const oppLabel = oppTrans === "mega" ? `${CYN}${opp.species}${R} ${YEL}[MEGA]${R}`
  : oppTrans === "gigantamax" ? `${CYN}${opp.species}${R} ${YEL}[GMAX ${state.opponent.gmaxTurnsRemaining}T]${R}`
  : oppTrans === "primal" ? `${CYN}${opp.species}${R} ${YEL}[PRIMAL]${R}`
  : `${CYN}${opp.species}${R}`;
```

메뉴 렌더링도 `item.label` 사용:

```typescript
...menuItems.map((item, i) => {
  const ptr = i === cursor ? `${YEL}>${R}` : " ";
  const lbl = i === cursor ? `${BLD}${item.label}${R}` : item.label;
  return `  ${ptr} ${lbl}`;
}),
```

- [ ] **Step 3: PvpClientRoomView opponent에 transformationType 추가**

`shared/pvp-types.ts`의 opponent에:

```typescript
opponent: {
  // ... existing
  transformationType?: "mega" | "gigantamax" | "primal" | null;
  gmaxTurnsRemaining?: number;
};
```

`pvp-room.ts`의 `getPlayerView`에서:

```typescript
opponent: {
  // ... existing
  transformationType: opp.transformationType,
  gmaxTurnsRemaining: opp.gmaxTurnsRemaining,
},
```

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/pvp.ts shared/pvp-types.ts packages/server/src/pvp/pvp-room.ts
git commit -m "feat(pvp): add mega/gmax UI options to CLI battle menu"
```

---

## Task 8: 전체 테스트 & 타입 체크

- [ ] **Step 1: 전체 서버 테스트**

```bash
cd packages/server && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 2: 타입 체크**

```bash
cd packages/server && npx tsc --noEmit
cd ../cli && npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 최종 Commit**

```bash
git add -A
git commit -m "feat(pvp): integrate mega evolution, gigantamax, and primal reversion"
```
