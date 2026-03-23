# pokelog Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational infrastructure — project setup, data layer, user system, server API, CLI client, and git polling with reward calculation.

**Architecture:** Monorepo with two packages (server + cli). Server uses Express with JSON file storage and atomic writes. CLI uses Commander for command parsing and inquirer for interactive prompts. Both packages share TypeScript types via a shared types file.

**Tech Stack:** TypeScript, Node.js, Express, Commander, inquirer, bcrypt, jsonwebtoken, vitest

**Spec:** `docs/superpowers/specs/2026-03-23-pokelog-design.md`

---

## File Structure

```
pokelog/
├── package.json                          # Root workspace config
├── tsconfig.json                         # Root TS config
├── .gitignore
├── packages/
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts                  # Server entry point
│   │   │   ├── app.ts                    # Express app setup
│   │   │   ├── storage/
│   │   │   │   ├── json-store.ts         # Atomic JSON read/write
│   │   │   │   ├── user-store.ts         # User CRUD operations
│   │   │   │   ├── config-store.ts       # Server config operations
│   │   │   │   └── sync-state-store.ts   # Polling state operations
│   │   │   ├── auth/
│   │   │   │   └── auth.ts              # Password hash, JWT issue/verify
│   │   │   ├── routes/
│   │   │   │   ├── auth-routes.ts        # register, login
│   │   │   │   ├── user-routes.ts        # profile, nickname, match
│   │   │   │   ├── game-routes.ts        # status, events, party, pokedex, inventory
│   │   │   │   ├── shop-routes.ts        # shop, buy, use item
│   │   │   │   ├── battle-routes.ts      # encounter, battle actions
│   │   │   │   ├── social-routes.ts      # ranking, other profiles
│   │   │   │   └── admin-routes.ts       # repo mgmt, config, polling
│   │   │   ├── game/
│   │   │   │   ├── reward.ts             # Byte calculation, EXP/point reward
│   │   │   │   ├── combo.ts              # Combo judgment and multiplier
│   │   │   │   ├── encounter.ts          # Wild encounter probability, ceiling, spawn
│   │   │   │   ├── battle.ts             # Damage calc, turn flow, battle state
│   │   │   │   ├── capture.ts            # Capture probability, success/fail
│   │   │   │   ├── growth.ts             # Level up, stat calc, evolution, move learn
│   │   │   │   └── pokemon-factory.ts    # Create pokemon instance from species data
│   │   │   ├── polling/
│   │   │   │   ├── polling-worker.ts     # Main polling loop
│   │   │   │   ├── git-client.ts         # Git commands (clone, fetch, log, diff-tree, cat-file)
│   │   │   │   └── commit-processor.ts   # Process commits → rewards per user
│   │   │   └── middleware/
│   │   │       └── auth-middleware.ts     # JWT verification middleware
│   │   └── tests/
│   │       ├── storage/
│   │       │   └── json-store.test.ts
│   │       ├── game/
│   │       │   ├── reward.test.ts
│   │       │   ├── combo.test.ts
│   │       │   ├── encounter.test.ts
│   │       │   ├── battle.test.ts
│   │       │   ├── capture.test.ts
│   │       │   └── growth.test.ts
│   │       └── polling/
│   │           ├── git-client.test.ts
│   │           └── commit-processor.test.ts
│   └── cli/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # CLI entry point (Commander setup)
│           ├── api-client.ts             # HTTP client to server API
│           ├── config.ts                 # ~/.pokelog/ config management
│           ├── commands/
│           │   ├── init.ts               # pokelog init
│           │   ├── auth.ts               # register, login, logout
│           │   ├── profile.ts            # profile, nickname, match/unmatch
│           │   ├── status.ts             # status
│           │   ├── events.ts             # events
│           │   ├── encounter.ts          # encounter (battle UI loop)
│           │   ├── party.ts              # party, party set
│           │   ├── storage.ts            # storage, withdraw, deposit
│           │   ├── pokemon.ts            # pokemon detail
│           │   ├── pokedex.ts            # pokedex
│           │   ├── inventory.ts          # inventory
│           │   ├── shop.ts               # shop, buy
│           │   ├── use-item.ts           # use item
│           │   ├── ranking.ts            # ranking
│           │   └── admin.ts              # pokelog-admin commands
│       ├── admin-entry.ts                # pokelog-admin standalone entry point
│           └── ui/
│               ├── display.ts            # ANSI art rendering, HP bars, boxes
│               └── prompts.ts            # inquirer prompt wrappers
├── data/
│   ├── pokemon/
│   │   ├── species.json                  # All pokemon species data
│   │   └── evolution.json                # Evolution conditions
│   ├── moves/
│   │   └── moves.json                    # All moves data
│   ├── types/
│   │   └── type-chart.json               # Type effectiveness chart
│   ├── regions/
│   │   └── default.json                  # Default encounter table
│   └── colorscripts/                     # Copied from pokemon-colorscripts
│       └── small/regular/                # ANSI art files
└── shared/
    └── types.ts                          # Shared TypeScript interfaces
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`
- Create: `shared/types.ts`

- [ ] **Step 1: Create root package.json with workspaces**

```json
{
  "name": "pokelog",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "dev:server": "npm run dev -w packages/server",
    "dev:cli": "npm run dev -w packages/cli"
  }
}
```

- [ ] **Step 2: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true,
    "resolveJsonModule": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
pokelog-data/
.pokelog/
*.js.map
```

- [ ] **Step 4: Create server package.json**

```json
{
  "name": "@pokelog/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.18.0",
    "bcrypt": "^5.1.0",
    "jsonwebtoken": "^9.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/bcrypt": "^5.0.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/uuid": "^9.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 5: Create server tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "../../shared/**/*"]
}
```

- [ ] **Step 6: Create cli package.json**

```json
{
  "name": "@pokelog/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "pokelog": "dist/index.js",
    "pokelog-admin": "dist/admin-entry.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "@inquirer/prompts": "^5.0.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 7: Create cli tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*", "../../shared/**/*"]
}
```

- [ ] **Step 8: Create shared/types.ts with all interfaces**

```typescript
// === Account & User ===
export interface UserAccount {
  id: string;
  password: string;
  nickname: string;
  createdAt: string;
  matchings: {
    git?: GitMatching;
    [key: string]: unknown;
  };
}

export interface GitMatching {
  emails: string[];
}

export interface UserCombo {
  count: number;
  lastCommitAt: string | null;
}

export interface EncounterCeiling {
  accumulatedBytes: number;
}

export interface PokemonMove {
  id: string;
  pp: number;
  maxPp: number;
}

export interface PokemonStats {
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
}

export interface OwnedPokemon {
  uid: string;
  species: string;
  nickname: string | null;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  caughtAt: string;
}

export interface WildPokemon {
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
}

export interface PendingEvent {
  id: string;
  type: "wild_encounter";
  pokemon: WildPokemon;
  createdAt: string;
  expiresAt: string;
}

export interface BattleState {
  eventId: string;
  myPokemonUid: string;
  turn: number;
  wild: WildPokemon;
}

export interface LogEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface UserData {
  account: UserAccount;
  points: number;
  totalExp: number;
  combo: UserCombo;
  encounterCeiling: EncounterCeiling;
  party: string[];
  pokemon: OwnedPokemon[];
  pokedex: string[];
  inventory: Record<string, number>;
  pendingEvents: PendingEvent[];
  battleState: BattleState | null;
  storage: OwnedPokemon[];
  log: LogEntry[];
}

// === Config ===
export interface RepoConfig {
  url: string;
  branches: string[];
}

export interface ComboConfig {
  bytesPerMinute: number;
  multipliers: number[];
  maxMultiplier: number;
}

export interface EncounterConfig {
  baseChance: number;
  ceilingBytes: number;
  timeLimitHours: number;
}

export interface ShopItem {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
}

export interface ServerConfig {
  server: { port: number };
  polling: {
    intervalMinutes: number;
    repos: RepoConfig[];
  };
  rewards: {
    expPerByte: number;
    pointsPerByte: number;
    combo: ComboConfig;
    encounter: EncounterConfig;
  };
  shop: {
    items: Record<string, ShopItem>;
  };
}

// === Sync State ===
export interface SyncState {
  repos: Record<string, Record<string, string>>;
}

// === Game Data (Static) ===
export interface SpeciesData {
  id: number;
  species: string;
  name: string;
  types: string[];
  baseStats: {
    hp: number;
    attack: number;
    defense: number;
    spAttack: number;
    spDefense: number;
    speed: number;
  };
  catchRate: number;
  expGroup: string;
  learnset: Record<string, string[]>;
  maxMoves: number;
}

export interface MoveData {
  id: string;
  name: string;
  type: string;
  category: "physical" | "special";
  power: number;
  accuracy: number;
  pp: number;
  description: string;
}

export interface EvolutionData {
  evolvesTo: string;
  condition: { type: "level"; level: number };
}

export interface EncounterEntry {
  species: string;
  weight: number;
  levelRange: [number, number];
}

export interface RegionData {
  name: string;
  encounters: EncounterEntry[];
}

export const MAX_PARTY_SIZE = 6;
export const MAX_MOVES = 4;
export const MAX_LOG_ENTRIES = 200;
export const MAX_LEVEL = 100;
```

- [ ] **Step 9: Install dependencies**

Run: `cd C:/Users/dlwog/Desktop/project/pokelog && npm install`
Expected: All packages installed, node_modules created

- [ ] **Step 10: Verify TypeScript compiles**

Run: `cd C:/Users/dlwog/Desktop/project/pokelog && npx tsc --noEmit -p packages/server/tsconfig.json`
Expected: No errors (may need placeholder src/index.ts)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold project with monorepo structure, shared types"
```

---

## Task 2: JSON Storage Layer (Atomic Read/Write)

**Files:**
- Create: `packages/server/src/storage/json-store.ts`
- Create: `packages/server/src/storage/user-store.ts`
- Create: `packages/server/src/storage/config-store.ts`
- Create: `packages/server/src/storage/sync-state-store.ts`
- Test: `packages/server/tests/storage/json-store.test.ts`

- [ ] **Step 1: Write tests for json-store**

```typescript
// packages/server/tests/storage/json-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readJson, writeJson } from "../../src/storage/json-store.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("json-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokelog-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("writes and reads JSON file", async () => {
    const filePath = path.join(tmpDir, "test.json");
    const data = { hello: "world", num: 42 };
    await writeJson(filePath, data);
    const result = await readJson(filePath);
    expect(result).toEqual(data);
  });

  it("returns null for non-existent file", async () => {
    const result = await readJson(path.join(tmpDir, "nope.json"));
    expect(result).toBeNull();
  });

  it("creates parent directories if needed", async () => {
    const filePath = path.join(tmpDir, "sub", "dir", "test.json");
    await writeJson(filePath, { ok: true });
    const result = await readJson(filePath);
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && npx vitest run tests/storage/json-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement json-store.ts**

```typescript
// packages/server/src/storage/json-store.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function readJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = filePath + "." + crypto.randomUUID() + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/storage/json-store.test.ts`
Expected: PASS

- [ ] **Step 5: Implement user-store.ts**

```typescript
// packages/server/src/storage/user-store.ts
import path from "node:path";
import fs from "node:fs/promises";
import { readJson, writeJson } from "./json-store.js";
import type { UserData } from "../../../shared/types.js";

const DATA_DIR = process.env.POKELOG_DATA_DIR || "pokelog-data";

function userPath(userId: string): string {
  return path.join(DATA_DIR, "users", `${userId}.json`);
}

export async function getUser(userId: string): Promise<UserData | null> {
  return readJson<UserData>(userPath(userId));
}

export async function saveUser(userData: UserData): Promise<void> {
  await writeJson(userPath(userData.account.id), userData);
}

export async function getAllUsers(): Promise<UserData[]> {
  const usersDir = path.join(DATA_DIR, "users");
  try {
    const files = await fs.readdir(usersDir);
    const users: UserData[] = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const user = await readJson<UserData>(path.join(usersDir, file));
        if (user) users.push(user);
      }
    }
    return users;
  } catch {
    return [];
  }
}

export async function findUserByEmail(email: string): Promise<UserData | null> {
  const users = await getAllUsers();
  return users.find((u) => {
    return u.account.matchings.git?.emails.includes(email);
  }) || null;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const user = await findUserByEmail(email);
  return user !== null;
}
```

- [ ] **Step 6: Implement config-store.ts and sync-state-store.ts**

```typescript
// packages/server/src/storage/config-store.ts
import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { ServerConfig } from "../../../shared/types.js";

const DATA_DIR = process.env.POKELOG_DATA_DIR || "pokelog-data";
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const DEFAULT_CONFIG: ServerConfig = {
  server: { port: 3000 },
  polling: { intervalMinutes: 5, repos: [] },
  rewards: {
    expPerByte: 1.0,
    pointsPerByte: 0.5,
    combo: {
      bytesPerMinute: 200,
      multipliers: [1.0, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
      maxMultiplier: 2.0,
    },
    encounter: {
      baseChance: 0.15,
      ceilingBytes: 10000,
      timeLimitHours: 48,
    },
  },
  shop: {
    items: {
      pokeball: { name: "몬스터볼", price: 100, catchBonus: 1.0 },
      superball: { name: "수퍼볼", price: 300, catchBonus: 1.5 },
      hyperball: { name: "하이퍼볼", price: 800, catchBonus: 2.0 },
      potion: { name: "상처약", price: 50, healAmount: 20 },
      superPotion: { name: "좋은상처약", price: 200, healAmount: 50 },
    },
  },
};

export async function getConfig(): Promise<ServerConfig> {
  const config = await readJson<ServerConfig>(CONFIG_PATH);
  return config || DEFAULT_CONFIG;
}

export async function saveConfig(config: ServerConfig): Promise<void> {
  await writeJson(CONFIG_PATH, config);
}
```

```typescript
// packages/server/src/storage/sync-state-store.ts
import path from "node:path";
import { readJson, writeJson } from "./json-store.js";
import type { SyncState } from "../../../shared/types.js";

const DATA_DIR = process.env.POKELOG_DATA_DIR || "pokelog-data";
const SYNC_PATH = path.join(DATA_DIR, "polling", "sync-state.json");

export async function getSyncState(): Promise<SyncState> {
  const state = await readJson<SyncState>(SYNC_PATH);
  return state || { repos: {} };
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await writeJson(SYNC_PATH, state);
}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add JSON storage layer with atomic writes"
```

---

## Task 3: Auth System

**Files:**
- Create: `packages/server/src/auth/auth.ts`
- Create: `packages/server/src/middleware/auth-middleware.ts`
- Test: (tested via integration with routes)

- [ ] **Step 1: Implement auth.ts**

```typescript
// packages/server/src/auth/auth.ts
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.POKELOG_JWT_SECRET || "pokelog-dev-secret";
const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function issueToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Implement auth-middleware.ts**

```typescript
// packages/server/src/middleware/auth-middleware.ts
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/auth.js";

export interface AuthRequest extends Request {
  userId?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증이 필요합니다" });
    return;
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "유효하지 않은 토큰입니다" });
    return;
  }
  req.userId = payload.userId;
  next();
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add auth system with bcrypt + JWT"
```

---

## Task 4: Game Data Files

**Files:**
- Create: `data/pokemon/species.json` (starter 3종 + 초반 포켓몬 ~20종)
- Create: `data/pokemon/evolution.json`
- Create: `data/moves/moves.json` (~20 basic moves)
- Create: `data/types/type-chart.json`
- Create: `data/regions/default.json`

- [ ] **Step 1: Create species.json with ~20 pokemon**

Include at minimum: bulbasaur, ivysaur, venusaur, charmander, charmeleon, charizard, squirtle, wartortle, blastoise, pidgey, pidgeotto, rattata, raticate, pikachu, raichu, caterpie, weedle, geodude, magikarp, dratini. Full data for each (id, species, name, types, baseStats, catchRate, expGroup, learnset, maxMoves).

- [ ] **Step 2: Create evolution.json**

Map species to evolution targets with level conditions.

- [ ] **Step 3: Create moves.json with ~20 moves**

Include: tackle, scratch, growl, tail-whip, vine-whip, ember, water-gun, thunder-shock, quick-attack, thunderbolt, flamethrower, hydro-pump, razor-leaf, bite, peck, string-shot, harden, bubble, rock-throw, wrap.

- [ ] **Step 4: Create type-chart.json**

Full 18-type effectiveness chart (normal, fire, water, electric, grass, ice, fighting, poison, ground, flying, psychic, bug, rock, ghost, dragon, dark, steel, fairy).

- [ ] **Step 5: Create default.json region**

All ~20 pokemon with appropriate weights and level ranges.

- [ ] **Step 6: Copy colorscripts from pokemon-colorscripts**

```bash
cp -r ../pokemon-colorscripts/colorscripts/small/regular data/colorscripts/small/regular
```

Only copy the ~20 pokemon we've defined.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add game data files (species, moves, types, regions, art)"
```

---

## Task 5: Game Logic — Reward, Combo, Encounter

**Files:**
- Create: `packages/server/src/game/reward.ts`
- Create: `packages/server/src/game/combo.ts`
- Create: `packages/server/src/game/encounter.ts`
- Create: `packages/server/src/game/pokemon-factory.ts`
- Test: `packages/server/tests/game/reward.test.ts`
- Test: `packages/server/tests/game/combo.test.ts`
- Test: `packages/server/tests/game/encounter.test.ts`

- [ ] **Step 1: Write reward tests**

```typescript
// packages/server/tests/game/reward.test.ts
import { describe, it, expect } from "vitest";
import { calculateReward } from "../../src/game/reward.js";

describe("reward", () => {
  it("calculates EXP and points from bytes", () => {
    const result = calculateReward(1000, 1.0, { expPerByte: 1.0, pointsPerByte: 0.5 });
    expect(result.exp).toBe(1000);
    expect(result.points).toBe(500);
  });

  it("applies combo multiplier", () => {
    const result = calculateReward(1000, 1.4, { expPerByte: 1.0, pointsPerByte: 0.5 });
    expect(result.exp).toBe(1400);
    expect(result.points).toBe(700);
  });
});
```

- [ ] **Step 2: Run test to verify fail, implement reward.ts, verify pass**

- [ ] **Step 3: Write combo tests**

```typescript
// packages/server/tests/game/combo.test.ts
import { describe, it, expect } from "vitest";
import { judgeCombo, getComboMultiplier } from "../../src/game/combo.js";
import type { ComboConfig } from "../../../shared/types.js";

const config: ComboConfig = {
  bytesPerMinute: 200,
  multipliers: [1.0, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
  maxMultiplier: 2.0,
};

describe("combo", () => {
  it("first commit starts at count 1", () => {
    const result = judgeCombo(null, 500, new Date(), config);
    expect(result.count).toBe(1);
  });

  it("increments on high density", () => {
    const prev = new Date("2026-03-23T10:00:00Z");
    const now = new Date("2026-03-23T10:05:00Z"); // 5 min later
    // 1500 bytes / 5 min = 300 B/min >= 200 → combo
    const result = judgeCombo({ count: 1, lastCommitAt: prev.toISOString(), }, 1500, now, config);
    expect(result.count).toBe(2);
  });

  it("resets to 1 on low density", () => {
    const prev = new Date("2026-03-23T10:00:00Z");
    const now = new Date("2026-03-23T11:00:00Z"); // 60 min later
    // 500 bytes / 60 min = 8.3 B/min < 200 → reset
    const result = judgeCombo({ count: 5, lastCommitAt: prev.toISOString(), }, 500, now, config);
    expect(result.count).toBe(1);
  });

  it("returns correct multiplier", () => {
    expect(getComboMultiplier(0, config)).toBe(1.0);
    expect(getComboMultiplier(2, config)).toBe(1.2);
    expect(getComboMultiplier(6, config)).toBe(2.0);
    expect(getComboMultiplier(99, config)).toBe(2.0); // capped
  });
});
```

- [ ] **Step 4: Run test to verify fail, implement combo.ts, verify pass**

- [ ] **Step 5: Write encounter tests**

Test probability judgment, ceiling accumulation, weighted species selection.

- [ ] **Step 6: Run test to verify fail, implement encounter.ts, verify pass**

- [ ] **Step 7: Implement pokemon-factory.ts**

Create a pokemon instance from species data at a given level — calculate stats, select moves from learnset, set HP.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add game logic for reward, combo, encounter"
```

---

## Task 6: Game Logic — Battle, Capture, Growth

**Files:**
- Create: `packages/server/src/game/battle.ts`
- Create: `packages/server/src/game/capture.ts`
- Create: `packages/server/src/game/growth.ts`
- Test: `packages/server/tests/game/battle.test.ts`
- Test: `packages/server/tests/game/capture.test.ts`
- Test: `packages/server/tests/game/growth.test.ts`

- [ ] **Step 1: Write battle tests**

Test damage calculation (physical, special, type effectiveness, miss), speed-based turn order.

- [ ] **Step 2: Run test to verify fail, implement battle.ts, verify pass**

```typescript
// Core functions to implement:
// - calculateDamage(attacker, defender, move, typeChart): { damage: number, missed: boolean, effectiveness: number }
// - determineTurnOrder(mySpeed, wildSpeed): "player" | "wild"
```

- [ ] **Step 3: Write capture tests**

Test capture probability formula with various HP% and ball types. Verify min(1.0, ...) clamping.

- [ ] **Step 4: Run test to verify fail, implement capture.ts, verify pass**

- [ ] **Step 5: Write growth tests**

Test EXP requirement (N^3), stat calculation formula, level-up detection, evolution detection.

- [ ] **Step 6: Run test to verify fail, implement growth.ts, verify pass**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add game logic for battle, capture, growth"
```

---

## Task 7: Git Polling System

**Files:**
- Create: `packages/server/src/polling/git-client.ts`
- Create: `packages/server/src/polling/commit-processor.ts`
- Create: `packages/server/src/polling/polling-worker.ts`
- Test: `packages/server/tests/polling/git-client.test.ts`
- Test: `packages/server/tests/polling/commit-processor.test.ts`

- [ ] **Step 1: Write git-client tests**

Test parsing of `git diff-tree` and `git cat-file` output. Use mocked/stubbed exec calls.

- [ ] **Step 2: Implement git-client.ts**

```typescript
// Core functions:
// - cloneBareRepo(url, targetDir): Promise<void>
// - fetchRepo(repoDir): Promise<void>
// - getNewCommits(repoDir, branch, lastHash): Promise<CommitInfo[]>
// - getCommitByteChanges(repoDir, commitHash): Promise<number>
// Each function wraps child_process.execFile for the corresponding git command.
```

- [ ] **Step 3: Run git-client tests, verify pass**

- [ ] **Step 4: Write commit-processor tests**

Test that commits are matched to users, rewards calculated, combo updated, encounters triggered.

- [ ] **Step 5: Implement commit-processor.ts**

```typescript
// processCommit(commit, config): orchestrates reward, combo, encounter for one commit
// processNewCommits(commits, config): processes all commits in order
```

- [ ] **Step 6: Run commit-processor tests, verify pass**

- [ ] **Step 7: Implement polling-worker.ts**

```typescript
// startPolling(config): setInterval that runs pollAllRepos each cycle
// pollAllRepos(config): for each repo → fetch → get new commits → process
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add git polling system with commit processing"
```

---

## Task 8: Server API Routes

**Files:**
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/routes/auth-routes.ts`
- Create: `packages/server/src/routes/user-routes.ts`
- Create: `packages/server/src/routes/game-routes.ts`
- Create: `packages/server/src/routes/shop-routes.ts`
- Create: `packages/server/src/routes/battle-routes.ts`
- Create: `packages/server/src/routes/social-routes.ts`
- Create: `packages/server/src/routes/admin-routes.ts`
- Create: `packages/server/src/index.ts`

- [ ] **Step 1: Create app.ts with Express setup**

```typescript
// Register all routes, middleware, error handling
```

- [ ] **Step 2: Implement auth-routes.ts**

```
POST /api/auth/register  — { id, password, nickname, starter }
  - starter must be "bulbasaur", "charmander", or "squirtle"
  - Use pokemon-factory.ts to create a Lv.5 starter instance
  - Add to user's pokemon[] and party[]
  - Give 5 pokeballs as starting inventory
POST /api/auth/login     — { id, password } → { token }
```

- [ ] **Step 3: Implement user-routes.ts**

```
GET    /api/user/profile           — own profile
PUT    /api/user/nickname          — { nickname }
POST   /api/user/match             — { app, identifier }
DELETE /api/user/match             — { app, identifier }
```

- [ ] **Step 4: Implement game-routes.ts**

```
GET  /api/game/status              — today summary
GET  /api/game/events              — pending events
GET  /api/game/party               — party list
PUT  /api/game/party               — { uids: string[] }
GET  /api/game/pokemon/:uid        — pokemon detail
GET  /api/game/pokedex             — caught species
GET  /api/game/inventory           — items
GET  /api/game/storage             — storage pokemon
POST /api/game/storage/withdraw    — { uid }
POST /api/game/storage/deposit     — { uid }
```

- [ ] **Step 5: Implement shop-routes.ts**

```
GET  /api/shop                     — item list + prices
POST /api/shop/buy                 — { item, quantity }
POST /api/shop/use                 — { item, pokemonUid }
```

- [ ] **Step 6: Implement battle-routes.ts**

```
POST /api/battle/start             — { eventId, pokemonUid }
POST /api/battle/action            — { action: "fight"|"catch"|"item"|"switch"|"run", data }
GET  /api/battle/state             — current battle state
```

- [ ] **Step 7: Implement social-routes.ts**

```
GET /api/social/ranking            — ?by=exp|level|pokedex|points
GET /api/social/profile/:nickname  — public profile
```

- [ ] **Step 8: Implement admin-routes.ts**

```
POST   /api/admin/repo             — { url, branches }
GET    /api/admin/repos             — repo list
DELETE /api/admin/repo             — { url }
GET    /api/admin/config            — current config
PUT    /api/admin/config            — { key, value }
GET    /api/admin/status            — server status
GET    /api/admin/users             — user list
POST   /api/admin/polling/run       — trigger manual poll
```

- [ ] **Step 9: Create index.ts entry point**

Start Express server and polling worker.

- [ ] **Step 10: Test server starts**

Run: `cd packages/server && npx tsx src/index.ts`
Expected: Server listening on port 3000

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add all server API routes"
```

---

## Task 9: CLI Client — Core Infrastructure

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/api-client.ts`
- Create: `packages/cli/src/config.ts`
- Create: `packages/cli/src/ui/display.ts`
- Create: `packages/cli/src/ui/prompts.ts`

- [ ] **Step 1: Implement config.ts**

Manage `~/.pokelog/config.json` and `~/.pokelog/auth.json`. Provide `getServerUrl()`, `getToken()`, `saveToken()`.

- [ ] **Step 2: Implement api-client.ts**

HTTP client wrapper that adds auth header and handles errors.

```typescript
// apiGet(path), apiPost(path, body), apiPut(path, body), apiDelete(path, body)
// All prepend server URL and add Bearer token
```

- [ ] **Step 3: Implement display.ts**

```typescript
// renderPokemonArt(species): reads and prints ANSI art file
// renderHpBar(current, max, width): █████░░░░░ format
// renderBox(lines): box drawing with ╔═╗║╚═╝
// renderPartyMember(pokemon): formatted line
```

- [ ] **Step 4: Implement prompts.ts**

```typescript
// selectAction(choices): inquirer list prompt wrapper
// confirmPrompt(message): yes/no
// inputPrompt(message): text input
// numberPrompt(message, min, max): number input
```

- [ ] **Step 5: Create index.ts with Commander program**

Register all subcommands (implemented in next task).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add CLI core infrastructure"
```

---

## Task 10: CLI Commands — All Commands

**Files:**
- Create: all files in `packages/cli/src/commands/`

- [ ] **Step 1: Implement init.ts**

`pokelog init --server <url>` — save server URL to ~/.pokelog/config.json

- [ ] **Step 2: Implement auth.ts**

`pokelog register` — interactive: ask id, password, nickname, starter selection (inquirer)
`pokelog login` — interactive: ask id, password → save token
`pokelog logout` — delete token

- [ ] **Step 3: Implement profile.ts**

`pokelog profile` — show own profile
`pokelog nickname <name>` — change nickname
`pokelog match/unmatch` — add/remove matching

- [ ] **Step 4: Implement status.ts**

`pokelog status` — formatted box with today's stats

- [ ] **Step 5: Implement events.ts**

`pokelog events` — list pending events with remaining time

- [ ] **Step 6: Implement encounter.ts (battle UI loop)**

This is the most complex CLI command. Interactive turn-based battle loop using inquirer:

```
1. Show wild pokemon art + HP
2. Show my pokemon HP
3. Prompt action (fight/catch/item/switch/run)
4. If fight → prompt move selection
5. Send action to server, receive result
6. Display result (damage, caught, miss, etc.)
7. Loop until battle ends
```

- [ ] **Step 7: Implement party.ts, storage.ts, pokemon.ts**

Party list, party set, storage commands, pokemon detail view.

- [ ] **Step 8: Implement pokedex.ts, inventory.ts**

Pokedex list, inventory display.

- [ ] **Step 9: Implement shop.ts, use-item.ts**

Shop display, buy items, use items outside battle.

- [ ] **Step 10: Implement ranking.ts**

Ranking display with --by flag.

- [ ] **Step 11: Implement admin.ts and admin-entry.ts**

Create `admin.ts` with all admin subcommands, and `admin-entry.ts` as a standalone Commander program entry point for the `pokelog-admin` binary.

- [ ] **Step 12: Test full CLI flow manually**

```bash
pokelog init --server http://localhost:3000
pokelog register
pokelog login
pokelog status
pokelog party
pokelog shop
```

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: add all CLI commands"
```

---

## Task 11: Integration Testing & Polish

- [ ] **Step 1: Run all unit tests**

Run: `npm test --workspaces`
Expected: All pass

- [ ] **Step 2: Start server and test full flow**

1. Start server
2. Register user with starter
3. Check status (empty)
4. Manually trigger polling with a test repo
5. Check status (rewards received)
6. Check events (if encounter triggered)
7. Enter battle
8. Buy items from shop
9. Check ranking

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: pokelog phase 1 complete — server, CLI, game logic, polling"
```
