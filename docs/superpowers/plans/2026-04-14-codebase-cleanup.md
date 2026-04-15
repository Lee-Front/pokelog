# Codebase Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the five-priority refactoring outlined in the handoff document — split battle-routes.ts, consolidate CLI screens onto the shared runtime, remove dead legacy prompts, consolidate game rule helpers, and fix stale docs.

**Architecture:** The server uses Express routes that delegate to game logic modules under `packages/server/src/game/`. The CLI uses Commander.js commands under `packages/cli/src/commands/` with a shared screen runtime (`screen.ts`) for in-place redraw. Refactoring moves logic out of route/command files into shared modules without changing external behavior.

**Tech Stack:** TypeScript 5.4, Express, Vitest, Commander.js, monorepo workspaces (`packages/server`, `packages/cli`)

**Verification after every task group:**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```

**Critical rules (do NOT break):**
- CLI = single active frame, in-place redraw, no output accumulation
- No duplicate Pokemon type/stat resolution — use `pokemon-state.ts` and `pokemon-stats.ts`
- Do not revert unrelated existing changes on the `refactor/codebase-cleanup` branch
- Do not touch `connect.ts` prompt copy unless specifically tasked — it has mixed/garbled legacy text that is a separate cleanup

---

## File Structure

### New files:
- `packages/server/src/game/game-errors.ts` (shared GameRuleError class)
- `packages/server/tests/game/battle-state.test.ts` (unit tests for extracted battle logic)
### Files to heavily modify:
- `packages/server/src/routes/battle-routes.ts` (1092→~400 lines, extract logic to existing modules)
- `packages/server/src/game/battle-state.ts` (210→~450 lines, receive extracted turn engine logic)
- `packages/cli/src/ui/prompts.ts` (249→~120 lines, delete dead raw functions)
- `packages/cli/src/commands/events.ts`, `pokedex.ts`, `shop.ts`, `inventory.ts`, `party.ts` (migrate to screen runtime)

### Files to lightly modify:
- `packages/server/src/game/growth.ts`, `item-usage.ts`, `held-item-usage.ts`, `form-change.ts` (minor dedup)
- `docs/pokemon-pokeapi-sync-status.md`, `docs/user-journey.md` (fix stale statements)

---

## Task 1: Remove duplicate helper functions from battle-routes.ts

`battle-routes.ts` has 6 functions (lines 36–221) that are already extracted into `battle-state.ts`. The route file still uses its own local copies. This task wires the routes to the shared module.

**Files:**
- Modify: `packages/server/src/routes/battle-routes.ts:36-221`
- Reference: `packages/server/src/game/battle-state.ts`

- [x] **Step 1: Verify battle-state.ts exports match route-local functions**

Read both files side-by-side. Confirm these 6 functions exist in `battle-state.ts` with compatible signatures:
- `applyBattleFormChange`
- `maybeSetWeather`
- `applyWeatherEndOfTurn`
- `checkHpForms`
- `revertBattleForms`
- `wildAttack`

- [x] **Step 2: Write a test that exercises existing battle flow end-to-end**

Run the existing test suite first to establish a green baseline:
```bash
npm.cmd run test -w packages/server
```
Record the output. All tests must pass before any changes.

- [x] **Step 3: Replace local helpers with imports from battle-state.ts**

In `battle-routes.ts`:
1. Add import: `import { applyBattleFormChange, maybeSetWeather, applyWeatherEndOfTurn, checkHpForms, revertBattleForms, wildAttack } from '../game/battle-state.js'`
2. Delete the local definitions of all 6 functions (lines ~36–221)
3. Remove any imports that were only used by the deleted local functions (if they're already imported in battle-state.ts)

- [x] **Step 4: Build and test**
```bash
npm.cmd run build -w packages/server && npm.cmd run test -w packages/server
```
Expected: all tests pass, no type errors.

- [x] **Step 5: Commit**
```bash
git add packages/server/src/routes/battle-routes.ts
git commit -m "refactor: replace battle-routes local helpers with battle-state imports"
```

---

## Task 2: Extract turn engine from handleFight into battle-state.ts

`handleFight` (lines 603–902) contains the core turn loop: pre-attack checks, speed/turn-order, playerAttack nested function, end-of-turn effects. Extract these into testable functions in `battle-state.ts`.

**Files:**
- Modify: `packages/server/src/routes/battle-routes.ts:603-902`
- Modify: `packages/server/src/game/battle-state.ts`
- Test: `packages/server/tests/api/battle-transformations.test.ts` (existing, verify no regression)

- [x] **Step 1: Write failing test for `executePlayerAttack`**

Create test in `packages/server/tests/game/battle-state.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { executePlayerAttack } from '../../src/game/battle-state.js';

describe('executePlayerAttack', () => {
  it('applies damage to wild pokemon', () => {
    // Use tests/api/battle-transformations.test.ts (lines 30-80) as fixture template.
    // That file shows how to set up user, pokemon, battle state via the HTTP helpers.
    // For unit tests here, build a minimal BattleState object inline:
    // { wild: { hp, maxHp, species, ... }, weather, playerStatStages, wildStatStages, ... }
    // Assert: wild hp decreases, move pp decreases
  });
});
```

- [x] **Step 2: Run test to verify it fails**
```bash
npm.cmd run test -w packages/server -- --run tests/game/battle-state.test.ts
```
Expected: FAIL — `executePlayerAttack` not exported.

- [x] **Step 3: Extract `executePlayerAttack` into battle-state.ts**

Move the nested `playerAttack()` logic (lines ~739–830 of battle-routes.ts) into a standalone exported function in `battle-state.ts`:
```typescript
export function executePlayerAttack(params: {
  battle: BattleState;
  myPokemon: OwnedPokemon;
  selectedMove: Move;
  selectedMoveData: MoveData;
  playerStatStages: StatStages;
  wildStatStages: StatStages;
  playerVolatile: string[];
  wildVolatile: string[];
  log: string[];
}): {
  damage: number;
  playerVolatile: string[];
  wildVolatile: string[];
  log: string[];
} {
  // Extracted logic from playerAttack()
}
```

- [x] **Step 4: Run test to verify it passes**
```bash
npm.cmd run test -w packages/server -- --run tests/game/battle-state.test.ts
```

- [x] **Step 5: Extract `resolvePreAttack` helper**

Extract pre-attack sleep/status check logic (lines ~672–706) into:
```typescript
export function resolvePreAttack(pokemon: OwnedPokemon, statusCondition: string | null, sleepTurns?: number): {
  canAttack: boolean;
  newStatus: string | null;
  sleepTurns?: number;
  log: string[];
}
```

- [x] **Step 6: Extract `determineBattleTurnOrder` helper**

Extract speed calculation + turn order (lines ~708–735) into:
```typescript
export function determineBattleTurnOrder(params: {
  playerSpeed: number;
  wildSpeed: number;
  playerStatStages: StatStages;
  wildStatStages: StatStages;
  playerStatus: string | null;
  wildStatus: string | null;
  playerMovePriority: number;
  wildMovePriority: number;
}): 'player' | 'wild'
```

- [x] **Step 7: Extract `applyEndOfTurnBattle` helper**

Extract end-of-turn logic (lines ~867–898) covering status ticks, gigantamax countdown, and faint checks.

- [x] **Step 8: Wire handleFight to use extracted functions**

Replace the inline logic in `handleFight` with calls to the new exported functions. `handleFight` should become a thin orchestrator: validate input → call battle engine functions → save state → return response.

- [x] **Step 9: Build and test full suite**
```bash
npm.cmd run build -w packages/server && npm.cmd run test -w packages/server
```

- [x] **Step 10: Commit**
```bash
git add packages/server/src/game/battle-state.ts packages/server/src/routes/battle-routes.ts packages/server/tests/game/battle-state.test.ts
git commit -m "refactor: extract turn engine from handleFight into battle-state"
```

---

## Task 3: Extract remaining route-level battle helpers

Move `maybeApplyAilment`, `maybeApplyStatChanges`, `applyMetaEffects`, `applyEndOfTurnEffects`, `handleFainted`, `doWildAttackAndCheck`, and `hasAlivePartyMembers` out of battle-routes.ts into battle-state.ts.

**Files:**
- Modify: `packages/server/src/routes/battle-routes.ts:224-531`
- Modify: `packages/server/src/game/battle-state.ts`

- [x] **Step 1: Write failing tests for key helpers**

Add tests to `packages/server/tests/game/battle-state.test.ts` for:
- `maybeApplyAilment` — given a move with ailment data, returns new status
- `maybeApplyStatChanges` — given stat change data, returns modified stages
- `applyEndOfTurnEffects` — given status condition, returns hp change

- [x] **Step 2: Run tests to verify they fail**

- [x] **Step 3: Move functions to battle-state.ts and export them**

Move these 7 functions from battle-routes.ts into battle-state.ts with proper type signatures. Update battle-routes.ts to import them.

- [x] **Step 4: Run tests to verify they pass**

- [x] **Step 5: Build and test full suite**
```bash
npm.cmd run build -w packages/server && npm.cmd run test -w packages/server
```

- [x] **Step 6: Commit**
```bash
git add packages/server/src/game/battle-state.ts packages/server/src/routes/battle-routes.ts packages/server/tests/game/battle-state.test.ts
git commit -m "refactor: extract battle helper functions from routes to battle-state"
```

---

## Task 4: Migrate simple CLI screens to shared screen runtime

Migrate `events.ts`, `pokedex.ts`, and `heal.ts` — the three simplest screens.

**Files:**
- Modify: `packages/cli/src/commands/events.ts` (152 lines → ~80 lines)
- Modify: `packages/cli/src/commands/pokedex.ts` (146 lines → ~80 lines)
- Modify: `packages/cli/src/commands/heal.ts` (143 lines — animation, minimal change)
- Reference: `packages/cli/src/commands/egg.ts` (migration pattern example)

- [x] **Step 1: Migrate events.ts to runMenuLoop**

Replace the custom loop (lines 87–149) with `runMenuLoop`:
- State: `{ message: ScreenMessage | null }`
- Items: map events to menu items
- onSelect: call `encounterCommand()` for the selected event
- Remove local `lineCount`, `first`, `redraw()` variables

- [x] **Step 2: Build CLI and manual smoke test**
```bash
npm.cmd run build -w packages/cli
```

- [x] **Step 3: Commit events.ts**
```bash
git add packages/cli/src/commands/events.ts
git commit -m "refactor: migrate events screen to shared screen runtime"
```

- [x] **Step 4: Migrate pokedex.ts to selectFrame or runMenuLoop**

Replace the custom loop (lines 112–143) with `selectFrame` or `runMenuLoop`:
- Items: pokedex entries with pagination
- Use `pageSize` option for scrolling
- Remove local `lineCount`, `first`, `redraw()` variables

- [x] **Step 5: Build CLI and commit pokedex.ts**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/pokedex.ts
git commit -m "refactor: migrate pokedex screen to shared screen runtime"
```

- [x] **Step 6: Review heal.ts — keep animation, remove only unnecessary local state**

`heal.ts` is animation-only (not interactive). If it uses `lineCount`/`first` just for redraw tracking, remove those and use `clearScreen()` from screen.ts between animation frames. Otherwise leave it as-is.

- [x] **Step 7: Build CLI and commit heal.ts (if changed)**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/heal.ts
git commit -m "refactor: simplify heal animation screen"
```

---

## Task 5: Migrate medium-complexity CLI screens

Migrate `shop.ts`, `inventory.ts`, and `party.ts`.

**Files:**
- Modify: `packages/cli/src/commands/shop.ts` (217 lines)
- Modify: `packages/cli/src/commands/inventory.ts` (431 lines)
- Modify: `packages/cli/src/commands/party.ts` (173 lines)

- [x] **Step 1: Migrate shop.ts to runMenuLoop**

- State: `{ category: string; message: ScreenMessage | null }`
- Replace `rawNumberInput()` with `inputFrame()` for quantity
- Items: shop items filtered by category
- Remove local `lineCount`, `first`, `redraw()` variables

- [x] **Step 2: Build and commit shop.ts**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/shop.ts
git commit -m "refactor: migrate shop screen to shared screen runtime"
```

- [x] **Step 3: Migrate inventory.ts to runMenuLoop**

- State: `{ mode: 'items' | 'targets'; message: ScreenMessage | null; selectedItem?: string }`
- Use state transitions for mode switches
- Items: category-filtered inventory or target pokemon list depending on mode
- Remove local `lineCount`, `firstRender`, `redraw()` variables

- [x] **Step 4: Build and commit inventory.ts**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/inventory.ts
git commit -m "refactor: migrate inventory screen to shared screen runtime"
```

- [x] **Step 5: Migrate party.ts to runMenuLoop or selectFrame**

- Items: party pokemon list with status indicators
- Art display: render in the `header` callback of `runMenuLoop` if supported, otherwise build the frame manually and use `selectFrame`
- Remove local `lineCount`, `first`, `redraw()` variables

- [x] **Step 6: Build and commit party.ts**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/party.ts
git commit -m "refactor: migrate party screen to shared screen runtime"
```

---

## Task 5b: Migrate complex CLI screens (storage.ts, encounter.ts)

These two screens are the most complex migrations. `storage.ts` (366 lines) has dual-panel navigation. `encounter.ts` (~860 lines) has a full battle animation system with state machine.

**Files:**
- Modify: `packages/cli/src/commands/storage.ts` (366 lines)
- Modify: `packages/cli/src/commands/encounter.ts` (~860 lines)
- Reference: `packages/cli/src/ui/screen.ts` (shared runtime API)

- [x] **Step 1: Migrate storage.ts**

`storage.ts` has dual-panel navigation (party/storage) with independent scroll states. Strategy:
- Use `runMenuLoop` with state tracking which panel is active: `{ panel: 'party' | 'storage'; message: ScreenMessage | null }`
- Panel switching via state transitions in `onSelect`
- Deposit/withdraw actions update state and return new transition
- Remove local `lineCount`, `first`, `redraw()` variables
- Keep the two-panel rendering in a custom `header` or `render` callback

- [x] **Step 2: Build and commit storage.ts**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/storage.ts
git commit -m "refactor: migrate storage screen to shared screen runtime"
```

- [x] **Step 3: Assess encounter.ts migration scope**

`encounter.ts` is a battle animation system with submode state machine ("menu"/"fight"/"bag"/"party") and frame-by-frame rendering. This may NOT fully migrate to `runMenuLoop` — the animation loop is fundamentally different from a menu. Strategy:
- Identify which sub-screens (item selection, pokemon selection) can use `selectFrame()`
- Keep the core animation loop as custom code but use `clearScreen()` from screen.ts instead of manual lineCount tracking
- Remove ad-hoc redraw patterns where possible

- [x] **Step 4: Migrate encounter.ts selectable sub-screens**

Replace inline item/pokemon selection loops with `selectFrame()`. Keep the battle animation loop custom but simplify its redraw tracking.

- [x] **Step 5: Build and commit encounter.ts**
```bash
npm.cmd run build -w packages/cli
git add packages/cli/src/commands/encounter.ts
git commit -m "refactor: migrate encounter sub-screens to shared screen runtime"
```

---

## Task 6: Delete dead legacy prompt functions

All 4 raw functions in `prompts.ts` have zero callers. Remove them.

**Files:**
- Modify: `packages/cli/src/ui/prompts.ts:50-249` (delete ~200 lines of dead code)

- [x] **Step 1: Verify zero callers with grep**

Search the entire codebase for `rawSelect`, `rawInput`, `rawPassword`, `rawConfirm` imports or calls. Confirm zero active usage.

- [x] **Step 2: Delete the 4 raw functions**

Remove from `prompts.ts`:
- `rawSelect` (lines 50–142)
- `rawInput` (lines 148–185)
- `rawPassword` (lines 187–224)
- `rawConfirm` (lines 247–249)

Also remove any imports that are only used by these functions (e.g., `enterRaw`, `exitRaw`, `waitKey` from raw-mode.ts if no other callers remain in this file).

- [x] **Step 3: Build CLI**
```bash
npm.cmd run build -w packages/cli
```

- [x] **Step 4: Commit**
```bash
git add packages/cli/src/ui/prompts.ts
git commit -m "refactor: remove dead legacy raw prompt functions"
```

---

## Task 7: Consolidate game rule error classes

Five files define identical `*Error extends Error` with `status` property. Extract to a shared base.

**Files:**
- Create: `packages/server/src/game/game-errors.ts`
- Modify: `packages/server/src/game/held-item-usage.ts:6-14` (`HeldItemError`)
- Modify: `packages/server/src/game/form-change.ts:13-21` (`FormChangeError`)
- Modify: `packages/server/src/game/item-usage.ts:8-16` (`ItemUseError`)
- Modify: `packages/server/src/game/pending-evolution.ts` (`PendingEvolutionError`)
- Modify: `packages/server/src/game/trade.ts` (`TradeError`)

- [x] **Step 1: Check if a shared GameError already exists**

Search the codebase for existing error base classes.

- [x] **Step 2: Create `game-errors.ts` with shared `GameRuleError`**

Create `packages/server/src/game/game-errors.ts`:
```typescript
export class GameRuleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
```

- [x] **Step 3: Replace all five error classes with the shared one**

In each of the 5 files, replace the local error class with `import { GameRuleError } from './game-errors.js'` and update all throw sites:
- `throw new HeldItemError(...)` → `throw new GameRuleError(...)`
- `throw new FormChangeError(...)` → `throw new GameRuleError(...)`
- `throw new ItemUseError(...)` → `throw new GameRuleError(...)`
- `throw new PendingEvolutionError(...)` → `throw new GameRuleError(...)`
- `throw new TradeError(...)` → `throw new GameRuleError(...)`

Also update ALL route handlers that catch these specific error types. Known catch sites:
- `packages/server/src/routes/game-routes.ts` (catches `FormChangeError`, `HeldItemError`, `PendingEvolutionError`)
- `packages/server/src/routes/shop-routes.ts` (catches `ItemUseError`)
- `packages/server/src/routes/battle-routes.ts` (if any)
- Search for ALL `instanceof *Error` patterns to find any others.

- [x] **Step 4: Build and test**
```bash
npm.cmd run build -w packages/server && npm.cmd run test -w packages/server
```

- [x] **Step 5: Commit**
```bash
git add packages/server/src/game/
git commit -m "refactor: consolidate game rule error classes into shared GameRuleError"
```

---

## Task 8: Fix stale documentation

**Files:**
- Modify: `docs/pokemon-pokeapi-sync-status.md:236`
- Modify: `docs/user-journey.md:101-102`

- [x] **Step 1: Fix sync-status line 236**

Replace the statement "owned Pokemon now reserve `variantId`, but no gameplay loop writes non-null variant ids yet" with an accurate statement reflecting that `form-change.ts` and encounter generation actively write `variantId`.

- [x] **Step 2: Fix user-journey trade evolution description**

Update lines 101–102 to accurately describe trade evolution mechanics: some require specific trade partner species (`extra.trade_species`), not just held items.

- [x] **Step 3: Add note about Pokemon trade locks**

Add mention that Pokemon can be locked/unlocked from trades via `POST /api/game/trades/lock` and `/unlock`.

- [x] **Step 4: Commit**
```bash
git add docs/pokemon-pokeapi-sync-status.md docs/user-journey.md
git commit -m "docs: fix stale variant and trade evolution statements"
```

---

## Task 9: Final verification and build

- [x] **Step 1: Full build**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli
```

- [x] **Step 2: Full test**
```bash
npm.cmd run test -w packages/server
```

- [x] **Step 3: Review git diff for accidental regressions**
```bash
git diff --stat master
```
