# Dedup, Split, Test Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up duplicated code patterns, split game-routes.ts into domain-specific route files, and add tests for untested game modules.

**Architecture:** Phase 1 extracts shared helpers to reduce duplication. Phase 2 splits the 962-line game-routes.ts into 5 focused route files + a slim core. Phase 3 adds unit tests for 7 untested game modules. Each phase builds on the previous — dedup first to simplify splitting, split before testing so tests target the final structure.

**Tech Stack:** TypeScript 5.4, Express, Vitest, monorepo workspaces (`packages/server`, `packages/cli`, `shared`)

**Verification after every task group:**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```

**Critical rules:**
- CLI = single active frame, in-place redraw, no output accumulation
- Do not revert unrelated existing changes on the `refactor/codebase-cleanup` branch
- All new routes must use `authMiddleware` and be registered under `/api/game`
- TDD for Phase 3: write failing test first, then implement

---

## Phase 1: Duplicate Code Cleanup

### Task 1: Extract Pokemon lookup helpers to pokemon-state.ts

`user.pokemon.find(p => p.uid === uid)` and the party+storage combo appear 15+ times across the codebase. Extract two reusable helpers.

**Files:**
- Modify: `packages/server/src/game/pokemon-state.ts` (add 2 functions)
- Create: `packages/server/tests/game/pokemon-state.test.ts`

- [ ] **Step 1: Write failing tests for the two new helpers**

Create `packages/server/tests/game/pokemon-state.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { findPokemonByUid, getPartyPokemon } from '../../src/game/pokemon-state.js';
import type { UserData, OwnedPokemon } from '../../../../shared/types.js';

function makeUser(party: Partial<OwnedPokemon>[], storage: Partial<OwnedPokemon>[] = []): UserData {
  return {
    party: party.map(p => p.uid!),
    pokemon: party as OwnedPokemon[],
    storage: storage as OwnedPokemon[],
  } as UserData;
}

describe('findPokemonByUid', () => {
  it('finds pokemon in party', () => {
    const user = makeUser([{ uid: 'a', species: 'pikachu' }]);
    expect(findPokemonByUid(user, 'a')?.species).toBe('pikachu');
  });

  it('finds pokemon in storage', () => {
    const user = makeUser([], [{ uid: 'b', species: 'eevee' }]);
    expect(findPokemonByUid(user, 'b')?.species).toBe('eevee');
  });

  it('returns undefined for unknown uid', () => {
    const user = makeUser([{ uid: 'a', species: 'pikachu' }]);
    expect(findPokemonByUid(user, 'zzz')).toBeUndefined();
  });

  it('prefers party over storage', () => {
    const user = makeUser(
      [{ uid: 'a', species: 'pikachu' }],
      [{ uid: 'a', species: 'raichu' }],
    );
    expect(findPokemonByUid(user, 'a')?.species).toBe('pikachu');
  });
});

describe('getPartyPokemon', () => {
  it('returns pokemon ordered by party array', () => {
    const user = makeUser([
      { uid: 'a', species: 'pikachu' },
      { uid: 'b', species: 'eevee' },
    ]);
    const result = getPartyPokemon(user);
    expect(result.map(p => p.species)).toEqual(['pikachu', 'eevee']);
  });

  it('skips missing uids', () => {
    const user = {
      party: ['a', 'missing'],
      pokemon: [{ uid: 'a', species: 'pikachu' }],
      storage: [],
    } as unknown as UserData;
    expect(getPartyPokemon(user)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
npm.cmd run test -w packages/server -- --run tests/game/pokemon-state.test.ts
```
Expected: FAIL — `findPokemonByUid` and `getPartyPokemon` not exported.

- [ ] **Step 3: Add the two helpers to pokemon-state.ts**

Add at the bottom of `packages/server/src/game/pokemon-state.ts`:
```typescript
import type { UserData, OwnedPokemon } from "../../../../shared/types.js";

export function findPokemonByUid(user: UserData, uid: string): OwnedPokemon | undefined {
  return user.pokemon.find((p) => p.uid === uid)
    ?? user.storage.find((p) => p.uid === uid);
}

export function getPartyPokemon(user: UserData): OwnedPokemon[] {
  return user.party
    .map((uid) => user.pokemon.find((p) => p.uid === uid))
    .filter((p): p is OwnedPokemon => p != null);
}
```

Note: `UserData` and `OwnedPokemon` may already be imported — check the existing imports first and merge if so.

- [ ] **Step 4: Run test to verify it passes**
```bash
npm.cmd run test -w packages/server -- --run tests/game/pokemon-state.test.ts
```

- [ ] **Step 5: Build and test full suite**
```bash
npm.cmd run build -w packages/server && npm.cmd run test -w packages/server
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/game/pokemon-state.ts packages/server/tests/game/pokemon-state.test.ts
git commit -m "refactor: extract findPokemonByUid and getPartyPokemon helpers"
```

---

### Task 2: Replace duplicated lookup patterns with shared helpers

Wire all duplicated call sites to use the new `findPokemonByUid` and `getPartyPokemon` helpers.

**Files to modify (findPokemonByUid — party+storage combo):**
- `packages/server/src/game/form-change.ts:130-131`
- `packages/server/src/game/pending-evolution.ts:15-18` (remove entire private `getPokemonByUid` function, update call site at line 72 to use `findPokemonByUid`)
- `packages/server/src/routes/game-routes.ts:238-239, 488-489, 903-904`

**Files to modify (getPartyPokemon — map+filter pattern):**
- `packages/server/src/routes/game-routes.ts:185, 247, 624`
- `packages/server/src/routes/admin-routes.ts:191`
- `packages/server/src/polling/commit-processor.ts:66`

- [ ] **Step 1: Update form-change.ts**

Replace the local lookup at lines 130-131 with:
```typescript
import { findPokemonByUid } from "./pokemon-state.js";
// ...
const pokemon = findPokemonByUid(user, pokemonUid);
```

- [ ] **Step 2: Update pending-evolution.ts**

Remove the private `getPokemonByUid` function (lines 15-18) entirely. Add `import { findPokemonByUid } from "./pokemon-state.js"`. Update the call site at line 72 from `getPokemonByUid(user, ...)` to `findPokemonByUid(user, ...)`.

- [ ] **Step 3: Update game-routes.ts party+storage lookups**

Replace lines 238-239 and 488-489 with `findPokemonByUid(user, uid)`.

- [ ] **Step 4: Update getPartyPokemon call sites**

Replace the `user.party.map(uid => user.pokemon.find(...)).filter(Boolean)` pattern at:
- `game-routes.ts:185, 247, 624`
- `admin-routes.ts:191`
- `commit-processor.ts:66`

with `getPartyPokemon(user)`.

- [ ] **Step 5: Build and test full suite**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/game/form-change.ts packages/server/src/game/pending-evolution.ts packages/server/src/routes/game-routes.ts packages/server/src/routes/admin-routes.ts packages/server/src/polling/commit-processor.ts
git commit -m "refactor: use shared findPokemonByUid and getPartyPokemon helpers"
```

---

### Task 3: Move TradePokemonCandidate to shared/types.ts

Identical interface defined in both `packages/server/src/game/trade.ts:14-21` and `packages/cli/src/logic/trade.ts:29-36`.

**Files:**
- Modify: `shared/types.ts` (add interface)
- Modify: `packages/server/src/game/trade.ts` (remove local definition, import from shared)
- Modify: `packages/cli/src/logic/trade.ts` (remove local definition, import from shared)

- [ ] **Step 1: Add TradePokemonCandidate to shared/types.ts**

Add near the other trade-related types:
```typescript
export interface TradePokemonCandidate {
  uid: string;
  species: string;
  speciesName: string;
  nickname: string | null;
  level: number;
  location: "party" | "storage";
}
```

- [ ] **Step 2: Update server trade.ts**

Remove the local `TradePokemonCandidate` interface definition and import it from shared types instead.

- [ ] **Step 3: Update CLI trade.ts**

Remove the local `TradePokemonCandidate` interface definition. Import from shared types and **re-export** it so downstream importers (`commands/trade.ts`, `tests/logic/trade.test.ts`) don't break:
```typescript
export type { TradePokemonCandidate } from "../../../../shared/types.js";
```

- [ ] **Step 4: Build and test**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```

- [ ] **Step 5: Commit**
```bash
git add shared/types.ts packages/server/src/game/trade.ts packages/cli/src/logic/trade.ts
git commit -m "refactor: move TradePokemonCandidate to shared types"
```

---

## Phase 2: Split game-routes.ts

Current state: 962 lines, 27 endpoints across 6 unrelated domains. Target: 5 new route files + slim core.

### Task 4: Extract trade-routes.ts

Trade endpoints (6 handlers) + `buildTradeView` helper.

**Files:**
- Create: `packages/server/src/routes/trade-routes.ts`
- Modify: `packages/server/src/routes/game-routes.ts` (remove lines 31-77, 313-421)
- Modify: `packages/server/src/app.ts` (register new router)

- [ ] **Step 1: Create trade-routes.ts**

Extract from game-routes.ts:
- `buildTradeView` helper (lines 31-77)
- `GET /trades` (lines 313-328)
- `GET /trades/candidates/:userId` (lines 330-343)
- `POST /trades/request` (lines 345-370)
- `POST /trades/:id/accept` (lines 372-391)
- `POST /trades/:id/reject` (lines 393-406)
- `POST /trades/:id/cancel` (lines 408-421)

Router setup:
```typescript
import { Router } from "express";
import { authMiddleware } from "../middleware/auth-middleware.js";
export const tradeRoutes = Router();
tradeRoutes.use(authMiddleware);
```

- [ ] **Step 2: Remove trade code from game-routes.ts**

Delete the extracted endpoints and `buildTradeView`. Remove any imports that become unused.

- [ ] **Step 3: Register in app.ts**

Add import and registration:
```typescript
import { tradeRoutes } from "./routes/trade-routes.js";
// ...
app.use("/api/game", tradeRoutes);
```

- [ ] **Step 4: Build and test**
```bash
npm.cmd run build -w packages/server && npm.cmd run test -w packages/server
```

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/routes/trade-routes.ts packages/server/src/routes/game-routes.ts packages/server/src/app.ts
git commit -m "refactor: extract trade-routes from game-routes"
```

---

### Task 5: Extract egg-routes.ts

Egg/gacha endpoints (4 handlers).

**Files:**
- Create: `packages/server/src/routes/egg-routes.ts`
- Modify: `packages/server/src/routes/game-routes.ts` (remove lines 716-868)
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Create egg-routes.ts**

Extract:
- `GET /eggs` (lines 716-733)
- `POST /eggs/buy` (lines 735-769)
- `POST /eggs/hatch` (lines 771-817)
- `POST /eggs/pull` (lines 819-868)

- [ ] **Step 2: Remove egg code from game-routes.ts, clean unused imports**

- [ ] **Step 3: Register in app.ts**
```typescript
import { eggRoutes } from "./routes/egg-routes.js";
app.use("/api/game", eggRoutes);
```

- [ ] **Step 4: Build and test**

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/routes/egg-routes.ts packages/server/src/routes/game-routes.ts packages/server/src/app.ts
git commit -m "refactor: extract egg-routes from game-routes"
```

---

### Task 6: Extract evolution-routes.ts

Evolution + form-change endpoints (4 handlers).

**Files:**
- Create: `packages/server/src/routes/evolution-routes.ts`
- Modify: `packages/server/src/routes/game-routes.ts` (remove lines 478-531, 870-940)
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Create evolution-routes.ts**

Extract:
- `GET /evolutions/pending` (lines 478-498)
- `POST /evolutions/resolve` (lines 500-531)
- `GET /form-change/rules/:species` (lines 870-887)
- `POST /form-change` (lines 889-940)

- [ ] **Step 2: Remove from game-routes.ts, clean unused imports**

- [ ] **Step 3: Register in app.ts**

- [ ] **Step 4: Build and test**

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/routes/evolution-routes.ts packages/server/src/routes/game-routes.ts packages/server/src/app.ts
git commit -m "refactor: extract evolution-routes from game-routes"
```

---

### Task 7: Extract item-routes.ts

Item equip/unequip + inventory + healing (4 handlers).

**Files:**
- Create: `packages/server/src/routes/item-routes.ts`
- Modify: `packages/server/src/routes/game-routes.ts` (remove lines 290-311, 533-598, 615-637)
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Create item-routes.ts**

Extract:
- `GET /inventory` (lines 290-311)
- `POST /items/equip` (lines 533-565)
- `POST /items/unequip` (lines 567-598)
- `POST /heal` (lines 615-637)

- [ ] **Step 2: Remove from game-routes.ts, clean unused imports**

- [ ] **Step 3: Register in app.ts**

- [ ] **Step 4: Build and test**

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/routes/item-routes.ts packages/server/src/routes/game-routes.ts packages/server/src/app.ts
git commit -m "refactor: extract item-routes from game-routes"
```

---

### Task 8: Extract storage-routes.ts

Storage deposit/withdraw endpoints (3 handlers).

**Files:**
- Create: `packages/server/src/routes/storage-routes.ts`
- Modify: `packages/server/src/routes/game-routes.ts` (remove lines 600-613, 639-714 — skip 615-637 which is `/heal`, already extracted in Task 7)
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Create storage-routes.ts**

Extract:
- `GET /storage` (lines 600-613)
- `POST /storage/withdraw` (lines 639-673)
- `POST /storage/deposit` (lines 675-714)

- [ ] **Step 2: Remove from game-routes.ts, clean unused imports**

- [ ] **Step 3: Register in app.ts**

- [ ] **Step 4: Build and test**

- [ ] **Step 5: Commit**
```bash
git add packages/server/src/routes/storage-routes.ts packages/server/src/routes/game-routes.ts packages/server/src/app.ts
git commit -m "refactor: extract storage-routes from game-routes"
```

---

### Task 9: Clean up remaining game-routes.ts

After all extractions, game-routes.ts should contain only core endpoints (~8 handlers, ~350 lines):
- `GET /status`, `GET /events`, `GET /history`
- `GET /party`, `PUT /party`
- `GET /pokemon/:uid`, `GET /pokedex`
- `GET /regions`, `PUT /region`

(9 endpoints total, ~330 lines with utility helpers `getLogSource`, `getLogSummary`)

- [ ] **Step 1: Clean up imports — remove everything that's no longer used**

- [ ] **Step 2: Verify the remaining endpoints are correct and well-ordered**

- [ ] **Step 3: Full build and test**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/routes/game-routes.ts
git commit -m "refactor: clean up game-routes after route extraction"
```

---

## Phase 3: Test Coverage for Untested Game Modules

### Task 10: Test pokemon-state.ts

Already partially started in Task 1. Add tests for the existing functions: `resolveSpeciesOrVariant`, `getEffectiveVariantId`, `getEffectiveVariant`, `getEffectiveTypes`, `getDisplaySpeciesName`.

**Files:**
- Modify: `packages/server/tests/game/pokemon-state.test.ts`

- [ ] **Step 1: Add tests for all exported functions**

Key test cases:
- `resolveSpeciesOrVariant`: known species, unknown species, variant id, unknown id
- `getEffectiveVariantId`: null/undefined combos, battleForm takes precedence
- `getEffectiveTypes`: base species types, variant type override, battleForm type override
- `getDisplaySpeciesName`: known species returns display name, unknown falls back to input

Note: These functions depend on `data-loader.js`. Use `vi.mock` to mock `getSpeciesByName`, `getVariantById`.

- [ ] **Step 2: Run tests**
```bash
npm.cmd run test -w packages/server -- --run tests/game/pokemon-state.test.ts
```

- [ ] **Step 3: Commit**
```bash
git add packages/server/tests/game/pokemon-state.test.ts
git commit -m "test: add unit tests for pokemon-state module"
```

---

### Task 11: Test pokemon-stats.ts

**Files:**
- Create: `packages/server/tests/game/pokemon-stats.test.ts`

- [ ] **Step 1: Write tests**

Key test cases:
- `applyNatureModifier`: boost (1.1x), reduction (0.9x), neutral nature, null nature
- `buildStats`: HP formula `(baseHp*2*level/100) + level + 10`, stat formula `(baseStat*2*level/100) + 5`
- `calculateStatsForLevel`: throws on unknown species
- `buildStatsForPokemon`: uses pokemon's species/level/nature/variantId

Mock: `data-loader.js` (getSpeciesByName, getNatureById), `pokemon-state.js` (getEffectiveVariant)

- [ ] **Step 2: Run tests and verify pass**

- [ ] **Step 3: Commit**
```bash
git add packages/server/tests/game/pokemon-stats.test.ts
git commit -m "test: add unit tests for pokemon-stats module"
```

---

### Task 12: Test inventory-catalog.ts

**Files:**
- Create: `packages/server/tests/game/inventory-catalog.test.ts`

- [ ] **Step 1: Write tests**

Key test cases:
- `isHoldableItem`: held-item category, mega-stone, evolution item, non-holdable
- `buildInventoryCatalogEntry`: ball with shopItem, healing with shopItem, held item, evolution item, unknown item fallback

Mock: `data-loader.js` (getItemById, getEvolutions)

- [ ] **Step 2: Run tests and verify pass**

- [ ] **Step 3: Commit**
```bash
git add packages/server/tests/game/inventory-catalog.test.ts
git commit -m "test: add unit tests for inventory-catalog module"
```

---

### Task 13: Test pokemon-gender.ts and inventory-utils.ts

Bundle two simple modules together.

**Files:**
- Create: `packages/server/tests/game/pokemon-gender.test.ts`
- Create: `packages/server/tests/game/inventory-utils.test.ts`

- [ ] **Step 1: Write pokemon-gender tests**

Key test cases:
- `resolvePokemonGender`: genderless (rate undefined, rate < 0), always male (rate 0), always female (rate >= 8), probabilistic
- `seededGenderRoll`: deterministic (same seed = same result), returns 0-1 range

- [ ] **Step 2: Write inventory-utils tests**

Key test cases:
- `incrementItem`: new item, existing item
- `decrementItem`: decrement to 0 (deletes key), decrement below 0
- `healPokemon`: partial heal (amount param, caps at maxHp), full heal (no amount: resets hp, moves.pp, statusCondition, sleepTurns to `undefined`)

- [ ] **Step 3: Run tests and verify pass**

- [ ] **Step 4: Commit**
```bash
git add packages/server/tests/game/pokemon-gender.test.ts packages/server/tests/game/inventory-utils.test.ts
git commit -m "test: add unit tests for pokemon-gender and inventory-utils"
```

---

### Task 14: Test event-factory.ts and game-errors.ts

Bundle two trivial modules together.

**Files:**
- Create: `packages/server/tests/game/event-factory.test.ts`
- Create: `packages/server/tests/game/game-errors.test.ts`

- [ ] **Step 1: Write event-factory tests**

Key test cases:
- Event ID starts with "evt-"
- Event type is "wild_encounter"
- Pokemon data passed through
- expiresAt offset correct (timeLimitHours * 3600000)

- [ ] **Step 2: Write game-errors tests**

Key test cases:
- Default status is 400
- Custom status code
- instanceof Error

- [ ] **Step 3: Run tests and verify pass**

- [ ] **Step 4: Commit**
```bash
git add packages/server/tests/game/event-factory.test.ts packages/server/tests/game/game-errors.test.ts
git commit -m "test: add unit tests for event-factory and game-errors"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full build**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli
```

- [ ] **Step 2: Full test**
```bash
npm.cmd run test -w packages/server
```

- [ ] **Step 3: Review git diff for regressions**
```bash
git diff --stat HEAD~15
```

- [ ] **Step 4: Verify game-routes.ts final line count**
Target: ~350 lines (down from 962).
