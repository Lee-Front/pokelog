/**
 * Aggregated barrel for the shared type system.
 *
 * Definitions live in `./types/<domain>.ts` files and are re-exported
 * here so existing `import { X } from "../shared/types.js"` paths keep
 * working unchanged. New imports may either continue to use this barrel
 * or pull directly from the domain file (e.g.
 * `from "../shared/types/pokemon.js"`).
 */
export * from "./types/integrations.js";
export * from "./types/account.js";
export * from "./types/pokemon.js";
export * from "./types/wild-encounter.js";
export * from "./types/trade.js";
export * from "./types/battle.js";
export * from "./types/tower.js";
export * from "./types/server-config.js";
export * from "./types/user-data.js";
export * from "./types/game-data.js";

// === Game-rule constants ===
export const MAX_PARTY_SIZE = 6;
export const MAX_MOVES = 4;
export const MAX_LOG_ENTRIES = 200;
export const MAX_LEVEL = 100;
