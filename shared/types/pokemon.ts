// === Pokemon Core ===
export interface PokemonMove {
  id: string;
  pp: number;
  maxPp: number;
  /** Number of PP Up (or equivalent) applications. Max 3 per move in canon. */
  ppUpsUsed?: number;
}

export interface PokemonStats {
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
}

export interface IndividualValues {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export type PrimaryStatus = "poison" | "burn" | "paralysis" | "sleep" | "freeze";

export interface VolatileStatus {
  id: string;
  turnsRemaining: number;
}

export type PokemonGender = "male" | "female" | "genderless";

export interface OwnedPokemon {
  uid: string;
  species: string;
  variantId?: string | null;
  nickname: string | null;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  caughtAt: string;
  gender?: PokemonGender | null;
  friendship?: number;
  heldItem?: string | null;
  abilityId?: string | null;
  moveUsageCounts?: Record<string, number>;
  damageTakenTotal?: number;
  nature?: string;
  isShiny?: boolean;
  statusCondition?: PrimaryStatus | null;
  sleepTurns?: number;
  hasGigantamaxFactor?: boolean;
  /**
   * Count of vitamins applied per stat (0–10 each). We do not model the full
   * canon EV system; instead each application directly boosts the final stat
   * (see `applyVitamin` in item-usage). This counter enforces the canon cap
   * of 10 uses per stat (equivalent to +100 EV).
   */
  appliedVitamins?: {
    hp: number;
    attack: number;
    defense: number;
    spAttack: number;
    spDefense: number;
    speed: number;
  };
  // ── Individual Values (0-31 each) ──
  ivs?: IndividualValues;
  // ── Gen 9 / Tera ──
  teraType?: string | null;
  /**
   * A move id queued to be learned but blocked because the pokemon
   * already knows {@link MAX_MOVES} moves. The user must explicitly call
   * the "learn pending move" endpoint and pick a move to forget before
   * this slot can be filled. Cleared once the user resolves it (or
   * declines the move). Canon: a level-up move that can't fit prompts
   * the player to forget another move; we model that prompt as queued
   * server state rather than blocking commit-rewards mid-flight.
   */
  pendingMoveLearn?: string;
  // ── Fusion (Kyurem/Necrozma/Calyrex) ──
  fusedPartnerUid?: string;
  fusedPartnerData?: {
    species: string;
    level: number;
    stats: PokemonStats;
    moves: PokemonMove[];
    abilityId?: string | null;
    nature?: string;
    heldItem?: string | null;
    gender?: PokemonGender | null;
    ivs?: IndividualValues;
  };
}

export type EggTierId = "common" | "rare" | "epic" | "legend" | "manaphy";

export interface OwnedEgg {
  id: string;
  tier: EggTierId;
  createdAt: string;
}
