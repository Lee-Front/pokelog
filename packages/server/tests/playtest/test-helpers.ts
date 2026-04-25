/**
 * Common helpers for AI playtest scenarios.
 *
 * Wraps the admin /test/* endpoints (mint points, items, pokemon; force
 * encounters; clear battle state) and a couple of read-side helpers.
 *
 * The admin endpoints are only mounted when ADMIN_TEST_ENABLED — which
 * triggers when NODE_ENV !== "production" OR POKELOG_ENABLE_ADMIN_TEST=1.
 * test-context.ts ensures the latter is set.
 *
 * Admin authentication: x-admin-key header (NOT bearer). HttpClient
 * already handles header injection; tests construct an admin-scoped
 * client via http.asAdmin().
 */
import type { HttpClient } from "./api-helpers.js";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";

function adminClient(http: HttpClient, adminKey?: string): HttpClient {
  const key = adminKey ?? http.adminKey ?? process.env.POKELOG_ADMIN_KEY;
  return http.asAdmin(key);
}

export interface CommitOutcome {
  exp: number;
  points: number;
  combo: number;
  multiplier: number;
  encounter?: unknown;
}

/**
 * Trigger a synthetic commit reward for `userId`. Bypasses git polling —
 * the server applies the same reward calculation it would for a real
 * commit of `bytes` size.
 */
export async function simulateCommit(
  http: HttpClient,
  userId: string,
  bytes: number,
  adminKey?: string,
): Promise<CommitOutcome> {
  const admin = adminClient(http, adminKey);
  const res = await admin.post("/api/admin/test/commit", { userId, bytes });
  if (res.status !== 200) {
    throw new Error(`simulateCommit failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as CommitOutcome;
}

export async function injectPoints(
  http: HttpClient,
  userId: string,
  amount: number,
  adminKey?: string,
): Promise<number> {
  const admin = adminClient(http, adminKey);
  const res = await admin.post("/api/admin/test/give-points", { userId, amount });
  if (res.status !== 200) {
    throw new Error(`injectPoints failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { points: number }).points;
}

export async function injectItem(
  http: HttpClient,
  userId: string,
  item: string,
  quantity = 1,
  adminKey?: string,
): Promise<Record<string, number>> {
  const admin = adminClient(http, adminKey);
  const res = await admin.post("/api/admin/test/give-item", { userId, item, quantity });
  if (res.status !== 200) {
    throw new Error(`injectItem failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { inventory: Record<string, number> }).inventory;
}

export async function injectPokemon(
  http: HttpClient,
  userId: string,
  species: string,
  level = 5,
  options: { hasGigantamaxFactor?: boolean; adminKey?: string } = {},
): Promise<{ uid: string; species: string; level: number; hasGigantamaxFactor: boolean }> {
  const admin = adminClient(http, options.adminKey);
  const res = await admin.post("/api/admin/test/give-pokemon", {
    userId,
    species,
    level,
    hasGigantamaxFactor: options.hasGigantamaxFactor,
  });
  if (res.status !== 200) {
    throw new Error(`injectPokemon failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { pokemon: { uid: string; species: string; level: number; hasGigantamaxFactor: boolean } }).pokemon;
}

export async function forceEncounter(
  http: HttpClient,
  userId: string,
  options: { species?: string; level?: number; adminKey?: string } = {},
): Promise<{ id: string; species: string; level: number; expiresAt: string }> {
  const admin = adminClient(http, options.adminKey);
  const res = await admin.post("/api/admin/test/encounter", {
    userId,
    species: options.species,
    level: options.level,
  });
  if (res.status !== 200) {
    throw new Error(`forceEncounter failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { event: { id: string; species: string; level: number; expiresAt: string } }).event;
}

export async function clearBattle(
  http: HttpClient,
  userId: string,
  adminKey?: string,
): Promise<void> {
  const admin = adminClient(http, adminKey);
  const res = await admin.post("/api/admin/test/clear-battle", { userId });
  if (res.status !== 200) {
    throw new Error(`clearBattle failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/**
 * Returns the authenticated user's full profile. The /api/user/profile
 * endpoint returns the entire UserData minus account.password.
 */
export async function getUserState(http: HttpClient): Promise<UserData> {
  const res = await http.get("/api/user/profile");
  if (res.status !== 200) {
    throw new Error(`getUserState failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as UserData;
}

export async function getPartyList(http: HttpClient): Promise<OwnedPokemon[]> {
  const res = await http.get("/api/game/party");
  if (res.status !== 200) {
    throw new Error(`getPartyList failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { party: OwnedPokemon[] }).party ?? [];
}

/**
 * Wait until `predicate(state)` returns true, polling the user profile.
 * Useful for scenarios that need to wait for a delayed reward to land.
 */
export async function waitForUserState(
  http: HttpClient,
  predicate: (user: UserData) => boolean,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<UserData> {
  const intervalMs = options.intervalMs ?? 50;
  const timeoutMs = options.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  let last: UserData | null = null;
  while (Date.now() < deadline) {
    last = await getUserState(http);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitForUserState: predicate did not match within ${timeoutMs}ms`);
}
