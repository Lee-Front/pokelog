# PokeLog Codebase Refactoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all code duplication, fix critical security gaps, centralize data loading, and improve architecture — making the codebase maintainable and scalable.

**Architecture:** Extract shared utilities into focused modules (CLI: ui/colors, ui/raw-mode, ui/text, ui/art-cache, config/items; Server: game/data-loader, game/event-factory, game/inventory-utils). Fix security (JWT, admin auth, body limits). Remove inquirer dependency. Connect growth/evolution logic.

**Tech Stack:** TypeScript, Node.js, Express, vitest

---

## File Structure (New/Modified)

```
packages/cli/src/
  ui/
    colors.ts              # NEW — ANSI color constants
    raw-mode.ts            # NEW — enterRaw(), waitKey()
    text.ts                # NEW — visualWidth(), padRight(), artToLines(), mergeSideBySide()
    art-cache.ts           # NEW — shared art fetching + caching
    display.ts             # MODIFY — remove duplicated helpers, keep redraw/header/etc
    prompts.ts             # MODIFY — import from new modules
  config/
    items.ts               # NEW — ITEM_DISPLAY, BALL_ART_KEY, BAG_CATEGORIES
  commands/
    encounter.ts           # MODIFY — import shared utilities
    events.ts              # MODIFY — import shared utilities
    party.ts               # MODIFY — import shared utilities
    storage.ts             # MODIFY — import shared utilities
    shop.ts                # MODIFY — import shared utilities
    inventory.ts           # MODIFY — import shared utilities
    heal.ts                # MODIFY — import shared utilities
    pokedex.ts             # MODIFY — import shared utilities
  interactive.ts           # MODIFY — replace inquirer input() with rawInput()

packages/server/src/
  game/
    data-loader.ts         # NEW — centralized species/moves/typeChart/evolution/region loading
    event-factory.ts       # NEW — createEncounterEvent()
    inventory-utils.ts     # NEW — decrementItem(), incrementItem(), healPokemon()
    pokemon-factory.ts     # MODIFY — use data-loader
    battle.ts              # MODIFY — use data-loader
    capture.ts             # MODIFY — use data-loader
    growth.ts              # MODIFY — use data-loader
  routes/
    battle-routes.ts       # MODIFY — extract action handlers, use shared utils
    game-routes.ts         # MODIFY — use data-loader
    admin-routes.ts        # MODIFY — add auth, use shared utils
    shop-routes.ts         # MODIFY — use shared utils, named export
  middleware/
    admin-middleware.ts     # NEW — admin API key auth
  auth/
    auth.ts                # MODIFY — fail on missing JWT secret
  app.ts                   # MODIFY — body size limit, standardize imports
  polling/
    commit-processor.ts    # MODIFY — use data-loader, event-factory, connect growth
```

---

## Phase A: Security Fixes (P0)

### Task 1: JWT Secret — Fail on Missing

**Files:**
- Modify: `packages/server/src/auth/auth.ts:4`

- [ ] **Step 1: Fix JWT secret to require env var**

```typescript
// auth.ts line 4 — replace:
const JWT_SECRET = process.env.POKELOG_JWT_SECRET || "pokelog-dev-secret";
// with:
const JWT_SECRET = process.env.POKELOG_JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: POKELOG_JWT_SECRET environment variable is required");
  process.exit(1);
}
```

- [ ] **Step 2: Add .env.example to project root**

Create `.env.example`:
```
POKELOG_JWT_SECRET=change-me-to-a-random-secret
```

- [ ] **Step 3: Add .env.local for local dev**

Create `packages/server/.env.local`:
```
POKELOG_JWT_SECRET=dev-secret-local
POKELOG_ADMIN_KEY=dev-admin-key
```

Install `dotenv-cli` and update `packages/server/package.json` dev script (Windows 호환):
```json
"dev": "dotenv -e .env.local -- tsx watch src/index.ts"
```
```bash
npm install -D dotenv-cli -w packages/server
```

Add `.env.local` to `.gitignore`.

- [ ] **Step 4: Commit**

```
fix(security): require JWT secret from environment variable
```

---

### Task 2: Admin Route Authentication

**Files:**
- Create: `packages/server/src/middleware/admin-middleware.ts`
- Modify: `packages/server/src/routes/admin-routes.ts:1-5`

- [ ] **Step 1: Create admin middleware**

```typescript
// admin-middleware.ts
import type { Request, Response, NextFunction } from "express";

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.POKELOG_ADMIN_KEY;
  if (!expected) {
    res.status(503).json({ error: "Admin API is disabled (no POKELOG_ADMIN_KEY set)" });
    return;
  }
  if (key !== expected) {
    res.status(403).json({ error: "Invalid admin key" });
    return;
  }
  next();
}
```

- [ ] **Step 2: Apply to admin routes**

```typescript
// admin-routes.ts — add after Router creation:
import { adminMiddleware } from "../middleware/admin-middleware.js";
adminRoutes.use(adminMiddleware);
```

- [ ] **Step 3: Update .env.example**

```
POKELOG_ADMIN_KEY=change-me-admin-key
```

- [ ] **Step 4: Commit**

```
fix(security): add API key authentication to admin routes
```

---

### Task 3: Request Body Size Limit

**Files:**
- Modify: `packages/server/src/app.ts:14`

- [ ] **Step 1: Add body size limit**

```typescript
// Replace: app.use(express.json());
// With:
app.use(express.json({ limit: "1mb" }));
```

- [ ] **Step 2: Commit**

```
fix(security): add 1mb request body size limit
```

---

### Task 4: Verify User Data Not Tracked

- [ ] **Step 1: Verify pokelog-data is not tracked by git**

```bash
git ls-files pokelog-data/
git ls-files packages/server/pokelog-data/
```

If any files are listed, untrack them:
```bash
git rm --cached -r pokelog-data/ 2>/dev/null
git rm --cached -r packages/server/pokelog-data/ 2>/dev/null
```

- [ ] **Step 2: Verify .gitignore covers both paths**

Ensure `.gitignore` contains:
```
pokelog-data/
.env.local
```

- [ ] **Step 3: Commit (only if changes were made)**

```
fix(security): ensure user data files are not tracked
```

---

## Phase B: Server — Centralize Data Loading (P1)

### Task 5: Create Data Loader Module

**Files:**
- Create: `packages/server/src/game/data-loader.ts`

- [ ] **Step 1: Write tests for data loader**

Create `packages/server/tests/game/data-loader.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { getSpecies, getSpeciesByName, getMoves, getMoveById, getTypeChart, getRegion, getEvolutions, clearAllCaches } from "../../src/game/data-loader.js";

beforeEach(() => clearAllCaches());

describe("data-loader", () => {
  it("loads all species", () => {
    const species = getSpecies();
    expect(species.length).toBeGreaterThan(0);
    expect(species[0]).toHaveProperty("species");
    expect(species[0]).toHaveProperty("baseStats");
  });

  it("finds species by name", () => {
    const bulbasaur = getSpeciesByName("bulbasaur");
    expect(bulbasaur).toBeDefined();
    expect(bulbasaur!.name).toBe("이상해씨");
  });

  it("loads all moves", () => {
    const moves = getMoves();
    expect(moves.length).toBeGreaterThan(0);
  });

  it("finds move by id", () => {
    const tackle = getMoveById("tackle");
    expect(tackle).toBeDefined();
    expect(tackle!.power).toBeGreaterThan(0);
  });

  it("loads type chart", () => {
    const chart = getTypeChart();
    expect(chart).toHaveProperty("fire");
  });

  it("loads default region", () => {
    const region = getRegion("default");
    expect(region.encounters.length).toBeGreaterThan(0);
  });

  it("loads evolution data", () => {
    const evos = getEvolutions();
    expect(Object.keys(evos).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -w packages/server
```

- [ ] **Step 3: Implement data-loader**

```typescript
// packages/server/src/game/data-loader.ts
import { readFileSync } from "node:fs";
import { projectPath } from "../paths.js";
import type { SpeciesData, MoveData, EvolutionData, RegionData } from "../../../../shared/types.js";

type TypeChart = Record<string, Record<string, number>>;

let speciesCache: SpeciesData[] | null = null;
let movesCache: MoveData[] | null = null;
let typeChartCache: TypeChart | null = null;
let evolutionCache: Record<string, EvolutionData> | null = null;
const regionCache = new Map<string, RegionData>();

export function getSpecies(): SpeciesData[] {
  if (!speciesCache) {
    speciesCache = JSON.parse(readFileSync(projectPath("data/pokemon/species.json"), "utf-8"));
  }
  return speciesCache!;
}

export function getSpeciesByName(species: string): SpeciesData | undefined {
  return getSpecies().find((s) => s.species === species);
}

export function getMoves(): MoveData[] {
  if (!movesCache) {
    movesCache = JSON.parse(readFileSync(projectPath("data/moves/moves.json"), "utf-8"));
  }
  return movesCache!;
}

export function getMoveById(id: string): MoveData | undefined {
  return getMoves().find((m) => m.id === id);
}

export function getTypeChart(): TypeChart {
  if (!typeChartCache) {
    typeChartCache = JSON.parse(readFileSync(projectPath("data/types/type-chart.json"), "utf-8"));
  }
  return typeChartCache!;
}

export function getEvolutions(): Record<string, EvolutionData> {
  if (!evolutionCache) {
    evolutionCache = JSON.parse(readFileSync(projectPath("data/pokemon/evolution.json"), "utf-8"));
  }
  return evolutionCache!;
}

export function getRegion(name: string): RegionData {
  if (!regionCache.has(name)) {
    const data = JSON.parse(readFileSync(projectPath(`data/regions/${name}.json`), "utf-8"));
    regionCache.set(name, data);
  }
  return regionCache.get(name)!;
}

export function getAllSpeciesList(): Array<{ id: number; species: string; name: string }> {
  return getSpecies().map((s) => ({ id: s.id, species: s.species, name: s.name }));
}

export function clearAllCaches(): void {
  speciesCache = null;
  movesCache = null;
  typeChartCache = null;
  evolutionCache = null;
  regionCache.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```
refactor(server): centralize all static data loading into data-loader module
```

---

### Task 6: Migrate All Data Consumers to data-loader

**Files:**
- Modify: `packages/server/src/game/pokemon-factory.ts` — remove local loadSpecies/loadMoves, import from data-loader
- Modify: `packages/server/src/game/battle.ts` — remove local loadTypeChart, import from data-loader
- Modify: `packages/server/src/game/capture.ts` — remove local loadSpecies, import from data-loader
- Modify: `packages/server/src/game/growth.ts` — remove local loadSpecies/loadEvolution, import from data-loader
- Modify: `packages/server/src/routes/battle-routes.ts` — remove local loadSpecies/loadMoves, import from data-loader
- Modify: `packages/server/src/routes/game-routes.ts` — remove local getCurrentRegionName, import getRegion
- Modify: `packages/server/src/routes/admin-routes.ts` — remove inline regionData reads, import getRegion
- Modify: `packages/server/src/polling/commit-processor.ts` — remove local loadRegionData, import getRegion

For each file: remove the local cache variable, the local load function, and the local `_clearCache` export. Replace with imports from `data-loader.ts`.

- [ ] **Step 1: Migrate pokemon-factory.ts**

Remove `speciesCache`, `movesCache`, `loadSpecies()`, `loadMoves()`, `_clearCache()`. Import `getSpecies`, `getSpeciesByName`, `getMoves`, `getMoveById`, `clearAllCaches` from data-loader. Update `getAllSpecies()` to delegate to `getAllSpeciesList()`.

- [ ] **Step 2: Migrate battle.ts**

Remove `typeChartCache`, `loadTypeChart()`, `_clearCache()`. Import `getTypeChart` from data-loader.

- [ ] **Step 3: Migrate capture.ts**

Remove `speciesCache`, `loadSpecies()`, `_clearCache()`. Import `getSpeciesByName` from data-loader.

- [ ] **Step 4: Migrate growth.ts**

Remove `speciesCache`, `evolutionCache`, `loadSpecies()`, `loadEvolution()`, `_clearCache()`. Import from data-loader.

- [ ] **Step 5: Migrate battle-routes.ts**

Remove `speciesCache`, `movesCache`, `loadSpecies()`, `loadMoves()`, `getMoveData()`, `getSpeciesTypes()`. Import from data-loader.

- [ ] **Step 6: Migrate game-routes.ts, admin-routes.ts, commit-processor.ts**

Remove all local region loading. Import `getRegion("default")` from data-loader.

- [ ] **Step 7: Update existing tests that call `_clearCache()`**

기존 테스트 파일들 (`tests/game/battle.test.ts`, `capture.test.ts`, `growth.test.ts` 등)에서 각 모듈의 `_clearCache()`를 호출하는 부분을 `clearAllCaches()` (from data-loader)로 교체.

- [ ] **Step 8: Run all tests**

```bash
npm test -w packages/server
```

- [ ] **Step 9: Commit**

```
refactor(server): migrate all data consumers to centralized data-loader
```

---

## Phase C: Server — Extract Duplicated Game Logic (P1)

### Task 7: Create Event Factory

**Files:**
- Create: `packages/server/src/game/event-factory.ts`
- Modify: `packages/server/src/routes/admin-routes.ts`
- Modify: `packages/server/src/polling/commit-processor.ts`

- [ ] **Step 1: Create event-factory with test**

```typescript
// event-factory.ts
import crypto from "node:crypto";
import type { PendingEvent, WildPokemon } from "../../../../shared/types.js";

export function createEncounterEvent(
  wild: WildPokemon,
  timeLimitHours: number,
): PendingEvent {
  return {
    id: `evt-${crypto.randomUUID()}`,
    type: "wild_encounter",
    pokemon: wild,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + timeLimitHours * 3600000).toISOString(),
  };
}
```

- [ ] **Step 2: Replace 3 duplicate locations with import**

- admin-routes.ts /test/commit (lines ~184-190)
- admin-routes.ts /test/encounter (lines ~246-252)
- commit-processor.ts (lines ~84-92)

- [ ] **Step 3: Run tests, commit**

```
refactor(server): extract encounter event creation into event-factory
```

---

### Task 8: Create Inventory Utils

**Files:**
- Create: `packages/server/src/game/inventory-utils.ts`
- Modify: `packages/server/src/routes/battle-routes.ts`
- Modify: `packages/server/src/routes/shop-routes.ts`
- Modify: `packages/server/src/routes/game-routes.ts` (healParty in /heal endpoint)
- Modify: `packages/server/src/routes/admin-routes.ts`

- [ ] **Step 1: Create inventory-utils**

```typescript
// inventory-utils.ts
import type { OwnedPokemon } from "../../../../shared/types.js";

export function decrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  inventory[item] = (inventory[item] || 0) - qty;
  if (inventory[item] <= 0) delete inventory[item];
}

export function incrementItem(inventory: Record<string, number>, item: string, qty = 1): void {
  inventory[item] = (inventory[item] || 0) + qty;
}

export function healPokemon(pokemon: OwnedPokemon, amount?: number): void {
  if (amount !== undefined) {
    pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + amount);
  } else {
    pokemon.hp = pokemon.maxHp;
    for (const move of pokemon.moves) {
      move.pp = move.maxPp;
    }
  }
}
```

- [ ] **Step 2: Replace usages in battle-routes, shop-routes, game-routes, admin-routes**

- [ ] **Step 3: Run tests, commit**

```
refactor(server): extract inventory and heal utilities
```

---

### Task 9: Extract Battle Action Handlers

**Files:**
- Modify: `packages/server/src/routes/battle-routes.ts`

Refactor the 460-line `/action` endpoint into separate functions:

- [ ] **Step 1: Extract `handleFainted()` helper** (currently duplicated 5 times)

```typescript
function handleFainted(
  user: UserData, myPokemon: OwnedPokemon, battle: BattleState, log: string[],
  res: Response,
): boolean {
  if (myPokemon.hp > 0) return false;
  log.push(`${myPokemon.species}이(가) 쓰러졌다!`);
  if (hasAlivePartyMembers(user, myPokemon.uid)) {
    saveUser(user);
    res.json({ log, battleState: battle, result: "fainted" });
    return true;
  }
  user.battleState = null;
  saveUser(user);
  res.json({ log, battleState: null, result: "lose" });
  return true;
}
```

- [ ] **Step 2: Extract `handleFight()`, `handleCatch()`, `handleItem()`, `handleSwitch()`, `handleRun()`** as separate async functions

- [ ] **Step 3: Replace the switch/case in `/action` with function calls**

- [ ] **Step 4: Run tests, commit**

```
refactor(server): extract battle action handlers into focused functions
```

---

### Task 10: Connect Growth/Evolution Logic

**Files:**
- Modify: `packages/server/src/polling/commit-processor.ts`
- Modify: `packages/server/src/routes/admin-routes.ts`
- Modify: `packages/server/src/routes/battle-routes.ts`

- [ ] **Step 1: Read growth.ts signatures first**

`checkLevelUp(pokemon)` — pokemon을 in-place 변경하고 boolean 반환 (레벨업 여부).
`checkEvolution(pokemon)` — 진화 조건 충족 시 pokemon.species를 변경하고 새 species string 반환, 미충족 시 null.
`calculateStatsForLevel(species, level)` — 레벨업 후 스탯 재계산에 사용.

구현 전 반드시 `packages/server/src/game/growth.ts`를 읽어서 실제 시그니처를 확인할 것.

- [ ] **Step 2: Add level-up check after EXP distribution in commit-processor**

```typescript
import { checkLevelUp, checkEvolution } from "../game/growth.js";
// After EXP distribution loop:
for (const uid of user.party) {
  const poke = user.pokemon.find((p) => p.uid === uid);
  if (!poke) continue;
  const leveledUp = checkLevelUp(poke);
  if (leveledUp) {
    const evolved = checkEvolution(poke);
    // Update pokedex if evolved
    if (evolved && !user.pokedex.includes(evolved)) {
      user.pokedex.push(evolved);
    }
  }
}
```

- [ ] **Step 2: Same for admin-routes /test/commit**

- [ ] **Step 3: Add level-up check after battle EXP reward in battle-routes**

- [ ] **Step 4: Run tests, commit**

```
feat(server): connect growth and evolution logic to EXP distribution
```

---

### Task 11: Standardize Router Exports

**Files:**
- Modify: `packages/server/src/routes/battle-routes.ts` — `export default router` → `export const battleRoutes = Router()`
- Modify: `packages/server/src/routes/shop-routes.ts` — same pattern
- Modify: `packages/server/src/routes/social-routes.ts` — same pattern
- Modify: `packages/server/src/app.ts` — update imports to named

- [ ] **Step 1: Update all route files to named exports**
- [ ] **Step 2: Update app.ts imports**
- [ ] **Step 3: Run server, commit**

```
refactor(server): standardize all router exports to named exports
```

---

## Phase D: CLI — Extract Shared Utilities (P1)

### Task 12: Create Color Constants Module

**Files:**
- Create: `packages/cli/src/ui/colors.ts`
- Modify: 10+ command files to import

- [ ] **Step 1: Create colors.ts**

```typescript
// packages/cli/src/ui/colors.ts
export const DIM = "\x1b[90m";
export const RED = "\x1b[31m";
export const GRN = "\x1b[32m";
export const YEL = "\x1b[33m";
export const BLU = "\x1b[34m";
export const CYN = "\x1b[36m";
export const BLD = "\x1b[1m";
export const R   = "\x1b[0m";

// Compound styles
export const BYEL = `${BLD}${YEL}`;  // bold yellow
export const BRED = `${BLD}${RED}`;  // bold red
```

- [ ] **Step 2: Replace local color constants in all command files**

Files: encounter.ts, events.ts, party.ts, storage.ts, shop.ts, inventory.ts, heal.ts, pokedex.ts, servers.ts, leave.ts, display.ts

- [ ] **Step 3: Type check, commit**

```
refactor(cli): extract ANSI color constants into shared module
```

---

### Task 13: Create Raw Mode Module

**Files:**
- Create: `packages/cli/src/ui/raw-mode.ts`
- Modify: 8 command files

- [ ] **Step 1: Create raw-mode.ts**

```typescript
// packages/cli/src/ui/raw-mode.ts
export function enterRaw(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

export function waitKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.once("data", (chunk: string) => resolve(chunk));
  });
}

export function handleCtrlC(key: string): void {
  if (key === "\x03") {
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  }
}
```

- [ ] **Step 2: Replace local enterRaw/waitKey in all command files**

Files: encounter.ts, events.ts, party.ts, storage.ts, shop.ts, inventory.ts, heal.ts, pokedex.ts

- [ ] **Step 3: Update prompts.ts to import instead of defining locally**

- [ ] **Step 4: Type check, commit**

```
refactor(cli): extract raw-mode stdin utilities into shared module
```

---

### Task 14: Create Text Layout Module

**Files:**
- Create: `packages/cli/src/ui/text.ts`
- Modify: 7+ command files

- [ ] **Step 1: Create text.ts**

`stripAnsi`를 이 모듈에 정의하고, `display.ts`에서는 여기서 re-export한다 (순환 참조 방지).

```typescript
// packages/cli/src/ui/text.ts

/** ANSI escape 시퀀스 제거 — 이 모듈이 canonical 위치 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visualWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const c = ch.codePointAt(0) ?? 0;
    w += (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
         (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) ||
         (c >= 0xFF01 && c <= 0xFF60) ? 2 : 1;
  }
  return w;
}

export function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visualWidth(s)));
}

export function artToLines(art: string | null): string[] {
  return art ? art.trimEnd().split("\n") : [];
}

export function mergeSideBySide(
  leftLines: string[], rightLines: string[], leftWidth: number, gap: string = "    "
): string[] {
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padRight(leftLines[i] ?? "", leftWidth);
    const r = rightLines[i] ?? "";
    out.push(`  ${l}${gap}${r}`);
  }
  return out;
}
```

- [ ] **Step 2: Replace local definitions in all command files**

- [ ] **Step 3: Move `stripAnsi` from display.ts to text.ts**

In `display.ts`, remove the local `stripAnsi` definition and re-export from text.ts:
```typescript
export { stripAnsi } from "./text.js";
```
Remove local `stripAnsi` duplicate in storage.ts — import from text.ts instead.

- [ ] **Step 4: Type check, commit**

```
refactor(cli): extract text layout utilities (visualWidth, padRight, mergeSideBySide)
```

---

### Task 15: Create Art Cache Module

**Files:**
- Create: `packages/cli/src/ui/art-cache.ts`
- Modify: 7 command files

- [ ] **Step 1: Create art-cache.ts**

```typescript
// packages/cli/src/ui/art-cache.ts
import { fetchArt, fetchBallArt } from "./display.js";

const cache = new Map<string, string | null>();

export async function getCachedArt(species: string): Promise<string | null> {
  if (!cache.has(species)) {
    cache.set(species, await fetchArt(species));
  }
  return cache.get(species) ?? null;
}

export async function getCachedBallArt(ballType: string): Promise<string | null> {
  const key = `ball:${ballType}`;
  if (!cache.has(key)) {
    cache.set(key, await fetchBallArt(ballType));
  }
  return cache.get(key) ?? null;
}

export function clearArtCache(): void {
  cache.clear();
}
```

- [ ] **Step 2: Replace local art cache patterns in all command files**

- [ ] **Step 3: Type check, commit**

```
refactor(cli): extract shared art cache module
```

---

### Task 16: Create Item Config Module

**Files:**
- Create: `packages/cli/src/config/items.ts`
- Modify: encounter.ts, shop.ts, inventory.ts

- [ ] **Step 1: Create items.ts**

```typescript
// packages/cli/src/config/items.ts
export const ITEM_DISPLAY: Record<string, string> = {
  pokeball:    "몬스터볼",
  safariball:  "사파리볼",
  greatball:   "슈퍼볼",
  ultraball:   "울트라볼",
  masterball:  "마스터볼",
  potion:      "상처약",
  superPotion: "좋은 상처약",
  hyperPotion: "굉장한 상처약",
};

export const BALL_ART_KEY: Record<string, string> = {
  pokeball:   "MonsterBall",
  safariball: "SafariBall",
  greatball:  "GreatBall",
  ultraball:  "UltraBall",
  masterball: "MasterBall",
};

export const BAG_CATEGORIES = [
  { label: "몬스터볼", keys: ["pokeball", "safariball", "greatball", "ultraball", "masterball"] },
  { label: "상처약",   keys: ["potion", "superPotion", "hyperPotion"] },
] as const;

export function getItemName(key: string): string {
  return ITEM_DISPLAY[key] ?? key;
}

export function isBall(key: string): boolean {
  return key in BALL_ART_KEY;
}
```

- [ ] **Step 2: Replace duplicates in encounter.ts, shop.ts, inventory.ts**

- [ ] **Step 3: Type check, commit**

```
refactor(cli): extract item display metadata into shared config
```

---

## Phase E: CLI — Remove inquirer Dependency (P1)

### Task 17: Replace inquirer input() in Main Loop

**Files:**
- Modify: `packages/cli/src/interactive.ts`

- [ ] **Step 1: Replace `input()` with custom `rawInput()` from prompts.ts**

In `interactive.ts`, replace:
```typescript
import { input } from "@inquirer/prompts";
// ...
line = await input({ message: promptStr });
```
with:
```typescript
import { rawInput } from "./ui/prompts.js";
// ...
line = await rawInput(promptStr) ?? "";
```

- [ ] **Step 2: Remove `@inquirer/prompts` from package.json**

```bash
npm uninstall @inquirer/prompts -w packages/cli
```

- [ ] **Step 3: Remove `readline.emitKeypressEvents` if no longer needed**

- [ ] **Step 4: Type check, test interactively, commit**

```
refactor(cli): remove @inquirer/prompts dependency entirely
```

---

## Phase F: Structural Cleanup (P2)

### Task 18: Prototype Pollution Protection in Admin Config

**Files:**
- Modify: `packages/server/src/routes/admin-routes.ts`

- [ ] **Step 1: Add key whitelist validation to PUT /config**

```typescript
const ALLOWED_CONFIG_KEYS = new Set([
  "server.port",
  "polling.intervalMinutes",
  "rewards.expPerByte",
  "rewards.pointsPerByte",
  "rewards.encounter.baseChance",
  "rewards.encounter.ceilingBytes",
  "rewards.encounter.timeLimitHours",
]);

// In the handler:
if (!ALLOWED_CONFIG_KEYS.has(key)) {
  res.status(400).json({ error: `Config key not allowed: ${key}` });
  return;
}
```

- [ ] **Step 2: Commit**

```
fix(security): add config key whitelist to prevent prototype pollution
```

---

### Task 19: Art Path Traversal Hardening

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: Add path prefix validation after resolve**

```typescript
import path from "node:path";

// In art endpoints, after sanitization:
const resolved = path.resolve(artPath);
const baseDir = path.resolve(projectPath("data"));
if (!resolved.startsWith(baseDir)) {
  res.status(400).send("Invalid path");
  return;
}
```

- [ ] **Step 2: Commit**

```
fix(security): harden art API against path traversal
```

---

## Execution Order Summary

| Phase | Tasks | Focus | Estimated Scope |
|-------|-------|-------|-----------------|
| **A** | 1-4 | Security fixes | 4 small changes |
| **B** | 5-6 | Server data-loader | 1 new file + 8 migrations |
| **C** | 7-11 | Server logic extraction | 3 new files + route refactor |
| **D** | 12-16 | CLI utility extraction | 4 new files + 10 file updates |
| **E** | 17 | Remove inquirer | 1 file + dependency removal |
| **F** | 18-19 | Security hardening | 2 small fixes |

**Total: 19 tasks, ~40 file changes, estimated removal of 450+ duplicated lines**
