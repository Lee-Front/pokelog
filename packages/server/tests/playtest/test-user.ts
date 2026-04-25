/**
 * Test user factory for AI playtest scenarios.
 *
 * Constructs a fully-formed UserData (matching the shape in shared/types.ts)
 * with sensible defaults, persists it via the user-store, and mints a JWT
 * via issueToken so the caller can drive authenticated endpoints
 * immediately.
 *
 * userId must be alphanumeric only (USER_ID_PATTERN in user-store.ts is
 * /^[a-zA-Z0-9]+$/). The default uid generator uses random hex which
 * satisfies this; callers passing their own uid must do the same.
 */
import { randomUUID } from "node:crypto";
import { issueToken } from "../../src/auth/auth.js";
import { saveUser } from "../../src/storage/user-store.js";
import { createPokemon } from "../../src/game/pokemon-factory.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

export interface TestUserPokemonSpec {
  species: string;
  level: number;
}

export interface TestUserOptions {
  /**
   * Alphanumeric user id. Auto-generated if omitted. Must match
   * /^[a-zA-Z0-9]+$/ — the user-store rejects anything else.
   */
  uid?: string;
  nickname?: string;
  initialPoints?: number;
  initialExp?: number;
  initialPokemon?: TestUserPokemonSpec[];
  initialInventory?: Record<string, number>;
  initialPokedex?: string[];
}

export interface TestUser {
  user: UserData;
  token: string;
}

/**
 * Build a UserData with default values for every required field, then
 * apply the caller's overrides. Keeps every test scenario's user
 * construction one line.
 */
export async function createTestUser(opts: TestUserOptions = {}): Promise<TestUser> {
  const uid = opts.uid ?? `tester${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (!/^[a-zA-Z0-9]+$/.test(uid)) {
    throw new Error(`Test user uid must be alphanumeric, got: ${uid}`);
  }

  const nickname = opts.nickname ?? uid;
  const pokemon: OwnedPokemon[] = (opts.initialPokemon ?? []).map((spec) =>
    createPokemon(spec.species, spec.level),
  );

  const pokedex = opts.initialPokedex
    ? [...opts.initialPokedex]
    : Array.from(new Set(pokemon.map((p) => p.species)));

  const user: UserData = {
    account: {
      id: uid,
      // Mock hash — the auth-middleware uses issueToken-minted JWTs and
      // never re-verifies the password, so any non-empty string is fine.
      password: "$argon2id$mock$playtest",
      nickname,
      createdAt: new Date().toISOString(),
      matchings: {},
    },
    currentRegion: "default",
    points: opts.initialPoints ?? 0,
    totalExp: opts.initialExp ?? 0,
    combo: { count: 0, lastCommitAt: null },
    encounterCeiling: { accumulatedBytes: 0 },
    party: pokemon.slice(0, 6).map((p) => p.uid),
    pokemon,
    eggs: [],
    pokedex,
    inventory: { ...(opts.initialInventory ?? {}) },
    pendingEvents: [],
    pendingEvolutions: [],
    battleState: null,
    storage: pokemon.length > 6 ? pokemon.slice(6) : [],
    log: [],
    integrations: [],
  };

  await saveUser(user);
  const token = issueToken(uid);
  return { user, token };
}
