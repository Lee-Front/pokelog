/**
 * Playtest setup helper.
 *
 * Eagerly sets the env vars required by the playtest infrastructure, so
 * scenario files that import this at the top get a sane environment
 * without having to remember to call ensureEnvDefaults() themselves.
 *
 * Note: the global vitest setup (tests/global-setup.ts) already covers
 * POKELOG_JWT_SECRET. We restate the defaults here for documentation
 * and to make individual test files runnable in isolation (e.g.
 * `npx vitest run tests/playtest/<file>.test.ts`).
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.POKELOG_ENABLE_ADMIN_TEST = process.env.POKELOG_ENABLE_ADMIN_TEST ?? "1";
process.env.POKELOG_JWT_SECRET = process.env.POKELOG_JWT_SECRET ?? "playtest-secret";
process.env.POKELOG_ADMIN_KEY = process.env.POKELOG_ADMIN_KEY ?? "test-admin-key";
