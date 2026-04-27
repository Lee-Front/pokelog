import type {
  PokemonStats,
  PokemonMove,
  PokemonGender,
  PrimaryStatus,
  IndividualValues,
} from "./pokemon.js";
import type { EvolutionTrigger } from "./game-data.js";

// === Wild encounters / pending events ===
export interface WildPokemon {
  species: string;
  variantId?: string | null;
  level: number;
  hp: number;
  maxHp: number;
  stats: PokemonStats;
  moves: PokemonMove[];
  nature?: string;
  gender?: PokemonGender;
  ability?: string;
  isShiny?: boolean;
  statusCondition?: PrimaryStatus | null;
  teraType?: string | null;
  ivs?: IndividualValues;
}

export interface PendingEvent {
  id: string;
  type: "wild_encounter";
  pokemon: WildPokemon;
  createdAt: string;
  expiresAt: string;
}

export interface PendingEvolutionOption {
  branchId: string;
  targetSpecies: string;
  targetVariantId?: string;
  targetName: string;
}

export interface PendingEvolution {
  id: string;
  pokemonUid: string;
  sourceSpecies: string;
  sourceName: string;
  trigger: EvolutionTrigger;
  options: PendingEvolutionOption[];
  createdAt: string;
}
