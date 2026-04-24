/**
 * Canon Pokemon types shared between server routes and game logic.
 *
 * `ALL_TERA_TYPES` is the 18-type list used for Tera Type selection
 * (excludes the special "stellar" type which is granted only via
 * special events). `VALID_TERA_TYPES` includes "stellar" and is used
 * for validating Tera-type input from clients (since a Pokemon may
 * legitimately already carry a stellar Tera type).
 */
export const ALL_TERA_TYPES = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
] as const;

export type PokemonType = typeof ALL_TERA_TYPES[number];

/**
 * Types that may legitimately appear as a Pokemon's Tera type. Includes
 * the special "stellar" type (from Paradox / Terapagos-line events).
 */
export const VALID_TERA_TYPES: ReadonlySet<string> = new Set<string>([
  ...ALL_TERA_TYPES,
  "stellar",
]);
