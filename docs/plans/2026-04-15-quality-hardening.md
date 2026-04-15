# Quality Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical bugs, harden CLI terminal safety, add input validation, improve data layer reliability, and strengthen test coverage — based on senior-level audit findings.

**Architecture:** Five phases in dependency order. Phase 1 fixes actual bugs (small, safe). Phase 2 hardens CLI terminal handling. Phase 3 adds input validation to routes. Phase 4 improves storage reliability. Phase 5 backfills test coverage. Each phase builds on the previous without breaking existing behavior.

**Tech Stack:** TypeScript 5.4, Express, Vitest, Commander.js, monorepo workspaces

**Verification after every task:**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli && npm.cmd run test -w packages/server
```

---

## Phase 1: Critical Bug Fixes

### Task 1: Fix confusion self-damage hardcoded level

`checkPreAttack` uses hardcoded level 10 for confusion damage instead of the actual pokemon level. This makes confusion damage inaccurate at all levels.

**Files:**
- Modify: `packages/server/src/game/status-conditions.ts:60-64,92-98`
- Modify: `packages/server/src/game/battle-state.ts:455,645`
- Test: `packages/server/tests/game/status-conditions.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/server/tests/game/status-conditions.test.ts`:
```typescript
describe('checkPreAttack confusion self-damage', () => {
  it('uses actual level for confusion damage formula', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.33 → confused hit
    const result = checkPreAttack(null, [{ id: 'confusion', turns: 2 }], { attack: 100, defense: 100 }, 50);
    // damage = ((2*50/5+2) * 40 * 100 / 100) / 50 + 2 = (22 * 40 * 1) / 50 + 2 = 17 + 2 = 19
    expect(result.selfDamage).toBe(Math.floor(((2 * 50 / 5 + 2) * 40 * 100 / 100) / 50 + 2));
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Add `level` parameter to `checkPreAttack`**

In `status-conditions.ts`, change signature:
```typescript
export function checkPreAttack(
  status: PrimaryStatus | null | undefined,
  volatiles: VolatileStatus[],
  stats: PokemonStats,
  level: number,  // NEW
): { ... }
```

Update confusion damage formula (line 96):
```typescript
const selfDamage = Math.max(1, Math.floor(
  ((2 * level / 5 + 2) * 40 * stats.attack / stats.defense) / 50 + 2,
));
```

- [ ] **Step 3: Update callers in battle-state.ts**

Line 455: `checkPreAttack(player.statusCondition, volatiles, player.stats, player.level)`
Line 645: `checkPreAttack(battle.wild.statusCondition, wildVolatiles, battle.wild.stats, battle.wild.level)`

- [ ] **Step 4: Update existing tests that call checkPreAttack to pass level**

- [ ] **Step 5: Build and test**

- [ ] **Step 6: Commit**
```bash
git add packages/server/src/game/status-conditions.ts packages/server/src/game/battle-state.ts packages/server/tests/game/status-conditions.test.ts
git commit -m "fix: use actual pokemon level for confusion self-damage"
```

---

### Task 2: Fix trade archive data loss risk

`pruneTrades` calls `archiveTrades()` without awaiting — if archive write fails, trades are silently lost.

**Files:**
- Modify: `packages/server/src/storage/trade-store.ts:26-41`

- [ ] **Step 1: Make `pruneTrades` async and await `archiveTrades`**

Change `pruneTrades` from sync to async:
```typescript
async function pruneTrades(trades: TradeRecord[]): Promise<TradeRecord[]> {
  // ... same logic ...
  if (resolved.length > MAX_RESOLVED_TRADES) {
    const toArchive = resolved.slice(MAX_RESOLVED_TRADES);
    await archiveTrades(toArchive);  // was fire-and-forget, now awaited
    return [...pending, ...resolved.slice(0, MAX_RESOLVED_TRADES)];
  }
  return trades;
}
```

- [ ] **Step 2: Update `saveTrades` to decompose the expression**

`saveTrades` currently passes `pruneTrades()` directly into `writeJson()`:
```typescript
export async function saveTrades(trades: TradeRecord[]): Promise<void> {
  const pruned = await pruneTrades(trades);
  await writeJson(tradeStorePath(), pruned);
}
```

Also remove any `setTimeout` workarounds in `packages/server/tests/storage/trade-store.test.ts` that existed because of the fire-and-forget pattern.

- [ ] **Step 3: Build and test**

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/storage/trade-store.ts
git commit -m "fix: await trade archive to prevent data loss"
```

---

### Task 3: Fix polling worker duplicate interval

`startPolling()` has no guard against being called twice, which spawns multiple intervals.

**Files:**
- Modify: `packages/server/src/polling/polling-worker.ts:216-227`

- [ ] **Step 1: Add idempotency guard**

```typescript
export function startPolling(): void {
  if (pollingInterval) return;  // Already running

  pollAllRepos().catch(console.error);

  getConfig().then((config) => {
    if (pollingInterval) return;  // Guard against race in async
    const intervalMs = config.polling.intervalMinutes * 60 * 1000;
    pollingInterval = setInterval(() => {
      pollAllRepos().catch(console.error);
    }, intervalMs);
    console.log(`Polling started (every ${config.polling.intervalMinutes} min)`);
  });
}
```

- [ ] **Step 2: Build and test**

- [ ] **Step 3: Commit**
```bash
git add packages/server/src/polling/polling-worker.ts
git commit -m "fix: prevent duplicate polling intervals"
```

---

### Task 4: Fix capture division by zero

`calculateCaptureChance` divides by `maxHp` without guard — zero maxHp causes NaN.

**Files:**
- Modify: `packages/server/src/game/capture.ts:8-10`
- Test: `packages/server/tests/game/capture.test.ts`

- [ ] **Step 1: Add test for zero maxHp**

```typescript
it('handles zero maxHp without NaN', () => {
  const chance = calculateCaptureChance(1.0, 0, 0, 0.5);
  expect(Number.isFinite(chance)).toBe(true);
});
```

- [ ] **Step 2: Add guard**

```typescript
export function calculateCaptureChance(
  ballCatchBonus: number,
  currentHp: number,
  maxHp: number,
  baseCatchRate: number,
): number {
  if (maxHp <= 0) return Math.min(1.0, baseCatchRate);
  const chance = ballCatchBonus * (1 - currentHp / maxHp) * 0.5 + baseCatchRate;
  return Math.min(1.0, chance);
}
```

- [ ] **Step 3: Build and test**

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/game/capture.ts packages/server/tests/game/capture.test.ts
git commit -m "fix: guard against division by zero in capture chance"
```

---

### Task 5: Normalize battle probability check logic

`battle-state.ts` uses `Math.random() * 100 >= chance` in some places and `Math.random() * 100 < chance` in others. Both should use the same convention.

**Files:**
- Modify: `packages/server/src/game/battle-state.ts`

- [ ] **Step 1: Audit all probability patterns**

Search for `Math.random()` in battle-state.ts. Identify which pattern each uses:
- `>= chance` means "fail if random is high" (chance = success rate)
- `< chance` means "succeed if random is low" (chance = success rate)

The `< chance` pattern (line 374, flinch) is the standard: "roll under target = success". Normalize the `>= chance` patterns (line 213, ailment) to `< chance`.

- [ ] **Step 2: Normalize to `< chance` convention**

Line 213 and similar: `Math.random() * 100 >= chance` → `Math.random() * 100 < chance` is WRONG here — the semantics are inverted. The current logic says "if random >= chance, skip ailment" which means chance=100 always applies, chance=0 never applies. This is correct.

Actually: re-read the code carefully. `chance` at line 213 represents the ailment application chance. `Math.random() * 100 >= chance` means: "if roll is at or above the chance threshold, the ailment does NOT apply" — so a higher `chance` value means MORE likely to apply. This IS the correct semantic.

At line 374: `Math.random() * 100 < flinchChance` means: "if roll is below flinch chance, flinch occurs." This is also correct.

Both patterns are equivalent: `random >= chance → skip` is logically the same as `random < chance → apply`. The issue is **readability**, not correctness.

**Resolution:** Add clarifying comments only, no logic change needed.

```typescript
// line 213: chance% probability to NOT skip (higher chance = more likely to apply)
if (Math.random() * 100 >= chance) return { ... };

// line 374: flinchChance% probability to flinch
if (flinchChance > 0 && Math.random() * 100 < flinchChance) {
```

- [ ] **Step 3: Build and test**

- [ ] **Step 4: Commit**
```bash
git add packages/server/src/game/battle-state.ts
git commit -m "docs: clarify probability check conventions in battle-state"
```

---

## Phase 2: CLI Terminal Safety

### Task 6: Centralize Ctrl+C handling with cursor restore

Multiple files have `process.exit(0)` without cursor restore. Fix by using the existing `handleCtrlC` from `raw-mode.ts` which already restores cursor.

**Files:**
- Modify: `packages/cli/src/commands/history.ts:48` (bare `process.exit(0)`, no cursor restore)
- Modify: `packages/cli/src/commands/shop.ts:38` (bare `process.exit(0)` in rawNumberInput handler)

Only these 2 files need fixing. All other Ctrl+C handlers (egg.ts:205, inventory.ts:293/372, party.ts:115, storage.ts:247, encounter.ts:408, pokedex.ts:130, shop.ts:179) already have `\x1b[?25h` cursor restore before `process.exit(0)`.

Add `process.stdout.write("\x1b[?25h")` before each bare `process.exit(0)`.

- [ ] **Step 1: Fix each file**
- [ ] **Step 2: Build CLI**
- [ ] **Step 3: Commit**
```bash
git commit -m "fix(cli): restore cursor visibility on Ctrl+C in all screens"
```

---

### Task 7: Add try-catch around command execution in interactive.ts

If `executeCommand()` throws, raw mode is never restored and the alt screen is never exited.

**Files:**
- Modify: `packages/cli/src/interactive.ts:402-409`

- [ ] **Step 1: Wrap executeCommand in try-catch**

```typescript
process.stdout.write("\x1b[?25h");

let result: string;
try {
  result = await executeCommand(selected.cmd);
} catch (err) {
  // Restore terminal state after command failure
  enterRaw();
  message = `오류: ${err instanceof Error ? err.message : String(err)}`;
  first = true;
  continue;
}

if (result === "quit") {
  leaveAltScreen();
  return;
}
```

- [ ] **Step 2: Build CLI**
- [ ] **Step 3: Commit**
```bash
git add packages/cli/src/interactive.ts
git commit -m "fix(cli): restore terminal state on command execution failure"
```

---

### Task 8: Add error handling around Promise.all in CLI commands

Commands like `inventory.ts` and `storage.ts` call `Promise.all()` after entering raw mode but don't handle rejection.

**Files:**
- Modify: `packages/cli/src/commands/inventory.ts:269,408`
- Modify: `packages/cli/src/commands/storage.ts:204`

- [ ] **Step 1: Wrap Promise.all calls with try-catch that restores terminal**

For each file, wrap the `Promise.all` in try-catch that shows error and restores cursor before returning.

- [ ] **Step 2: Build CLI**
- [ ] **Step 3: Commit**
```bash
git commit -m "fix(cli): handle API failures gracefully in inventory and storage"
```

---

## Phase 3: Input Validation & Security

### Task 9: Add request body validation to battle routes

`battle-routes.ts` casts request body fields with `as` without validation.

**Files:**
- Modify: `packages/server/src/routes/battle-routes.ts`

- [ ] **Step 1: Add validation before each action handler**

For the `/action` route dispatcher, validate the `action` field:
```typescript
const { action, data } = req.body ?? {};
if (typeof action !== "string") {
  res.status(400).json({ error: "action is required" });
  return;
}
```

For `handleFight`, validate `moveId`:
```typescript
const moveId = data?.moveId;
if (typeof moveId !== "string") {
  res.status(400).json({ error: "moveId is required for fight action" });
  return;
}
```

Apply similar validation to `handleCatch` (itemId), `handleSwitch` (targetUid), `handleItem` (itemId, targetUid).

- [ ] **Step 2: Build and test**
- [ ] **Step 3: Commit**
```bash
git add packages/server/src/routes/battle-routes.ts
git commit -m "fix: add request body validation to battle routes"
```

---

### Task 10: Switch admin config PUT to whitelist

`admin-routes.ts` uses blacklist for dangerous keys — switch to whitelist.

**Files:**
- Modify: `packages/server/src/routes/admin-routes.ts:96-119`

- [ ] **Step 1: Define allowed config paths**

```typescript
const ALLOWED_CONFIG_PATHS = new Set([
  "polling.intervalMinutes",
  "rewards.expPerByte",
  "rewards.pointsPerByte",
  "rewards.combo.bytesPerMinute",
  "rewards.combo.maxMultiplier",
  "rewards.encounter.baseChance",
  "rewards.encounter.ceilingBytes",
  "rewards.encounter.timeLimitHours",
  "meta.serverName",
  "meta.displayName",
  "meta.apiVersion",
  "meta.featureFlags.pvp",
  "meta.featureFlags.trade",
  "meta.featureFlags.achievements",
  "meta.featureFlags.regions",
]);
```

- [ ] **Step 2: Validate key against whitelist**

```typescript
adminRoutes.put("/config", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || !ALLOWED_CONFIG_PATHS.has(key)) {
      return res.status(400).json({ error: "허용되지 않는 설정 키입니다" });
    }
    // ... rest of existing logic (split key, traverse, set value) ...
  }
});
```

- [ ] **Step 3: Build and test**
- [ ] **Step 4: Commit**
```bash
git add packages/server/src/routes/admin-routes.ts
git commit -m "security: use whitelist for admin config paths"
```

---

### Task 11: Standardize error response format

Routes use inconsistent response shapes. Standardize to `{ error: string }` for errors and `{ ...data }` for success.

**Files:**
- Audit all route files for `res.json({ ok: true })` pattern
- Replace with meaningful response data or keep `{ ok: true }` only for side-effect-only endpoints

This is a documentation task primarily — document the convention, then fix obvious violations.

- [ ] **Step 1: Audit and document response format convention**
- [ ] **Step 2: Fix obvious violations (routes returning `ok: true` with data should just return the data)**
- [ ] **Step 3: Build and test**
- [ ] **Step 4: Commit**
```bash
git commit -m "refactor: standardize API error response format"
```

---

## Phase 4: Data Layer Reliability

### Task 12: Distinguish file-not-found from JSON corruption in json-store

`readJson` returns `null` for all errors, making it impossible to debug corrupted files.

**Files:**
- Modify: `packages/server/src/storage/json-store.ts:5-12`

- [ ] **Step 1: Distinguish error types**

```typescript
export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;  // File doesn't exist — expected
    }
    console.error(`Failed to read ${filePath}:`, err);
    return null;  // Still return null but log the error
  }
}
```

- [ ] **Step 2: Build and test**
- [ ] **Step 3: Commit**
```bash
git add packages/server/src/storage/json-store.ts
git commit -m "fix: log JSON parse errors instead of silently returning null"
```

---

### Task 13: Add findUserByField helper to avoid loading all users

`getAllUsers()` is called in multiple places just to find one user by email/repo/nickname.

**Files:**
- Modify: `packages/server/src/storage/user-store.ts`

- [ ] **Step 1: Assess existing callers of getAllUsers()**

Identify which callers actually need all users vs. just one:
- `findUserByEmail` → needs single user
- `searchUsersByIdentity` → needs filtered list
- `getUsersForRepoCommit` → needs filtered list
- `isRepoEmailTaken` → needs boolean check
- Admin/social routes → need ranking/listing

- [ ] **Step 2: Optimize the most critical path**

For `findUserByEmail` and `isRepoEmailTaken`, add an index file or iterate files without loading full user data. If too complex, add a TODO comment documenting the scaling concern.

- [ ] **Step 3: Build and test**
- [ ] **Step 4: Commit**
```bash
git commit -m "perf: optimize user lookup to avoid loading all users"
```

---

### Task 14: Separate HTTP response from game logic in handleFainted

`handleFainted` in `battle-state.ts` calls `res.json()` directly, mixing Express HTTP with game logic.

**Files:**
- Modify: `packages/server/src/game/battle-state.ts:619-635`
- Modify: `packages/server/src/routes/battle-routes.ts` (callers)

- [ ] **Step 1: Make handleFainted return result object instead of calling res.json()**

Remove `res: Response` parameter. Return a structured result instead of calling `res.json()`.

**IMPORTANT:** `handleFainted` is also called from `doWildAttackAndCheck` (battle-state.ts), which itself takes `res: Response`. This refactoring cascades — both `handleFainted` AND `doWildAttackAndCheck` must stop using `res`. Both functions need to return structured results.

- [ ] **Step 2: Refactor doWildAttackAndCheck similarly**

Remove `res: Response` parameter. Return structured result (damage, faint status, game state) instead of calling `res.json()`.

- [ ] **Step 3: Update all callers in battle-routes.ts**

Callers of both functions in battle-routes.ts must now handle the returned result objects and send `res.json()` themselves.

- [ ] **Step 3: Build and test**
- [ ] **Step 4: Commit**
```bash
git add packages/server/src/game/battle-state.ts packages/server/src/routes/battle-routes.ts
git commit -m "refactor: separate handleFainted game logic from HTTP response"
```

---

## Phase 5: Test Coverage Improvements

### Task 15: Add error case tests for battle and shop routes

API tests mostly cover happy paths. Add error case coverage.

**Files:**
- Modify: `packages/server/tests/api/battle-transformations.test.ts`
- Modify: `packages/server/tests/api/shop-items.test.ts`

- [ ] **Step 1: Add invalid input tests for battle**

Test cases:
- Missing moveId in fight action
- Invalid action string
- Fight without active battle
- Switch to non-party pokemon

- [ ] **Step 2: Add invalid input tests for shop**

Test cases:
- Non-integer quantity
- Negative quantity
- Non-existent item ID
- Quantity exceeding affordable amount

- [ ] **Step 3: Run tests**
- [ ] **Step 4: Commit**
```bash
git commit -m "test: add error case coverage for battle and shop APIs"
```

---

### Task 16: Add battle-state edge case tests

Missing critical battle edge cases.

**Files:**
- Modify: `packages/server/tests/game/battle-state.test.ts`

- [ ] **Step 1: Add edge case tests**

Test cases:
- Stat stages clamp at ±6 (cannot exceed +6 or go below -6)
- HP never goes below 0 after damage
- PP never goes below 0 after use
- Confusion self-damage uses correct level (added in Task 1)

- [ ] **Step 2: Run tests**
- [ ] **Step 3: Commit**
```bash
git commit -m "test: add battle-state edge case tests for stat/HP/PP clamping"
```

---

### Task 17: Fix non-deterministic date usage in egg tests

`egg-gacha.test.ts` uses real `Date()` instead of fake timers.

**Files:**
- Modify: `packages/server/tests/game/egg-gacha.test.ts`

- [ ] **Step 1: Add vi.useFakeTimers() to egg tests that use dates**

```typescript
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });
```

- [ ] **Step 2: Run tests**
- [ ] **Step 3: Commit**
```bash
git add packages/server/tests/game/egg-gacha.test.ts
git commit -m "test: use fake timers in egg-gacha tests for determinism"
```

---

## Task 18: Final verification and build

- [ ] **Step 1: Full build**
```bash
npm.cmd run build -w packages/server && npm.cmd run build -w packages/cli
```

- [ ] **Step 2: Full test**
```bash
npm.cmd run test -w packages/server
```

- [ ] **Step 3: Review diff**
```bash
git diff --stat HEAD~18
```
