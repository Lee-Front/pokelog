// === Game Data (Static reference data loaded from data/) ===
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
  rawCaptureRate?: number;
  expGroup: string;
  baseExpYield?: number;
  weight?: number; // in hectograms (kg * 10)
  learnset: SpeciesLearnset;
  maxMoves: number;
  abilities?: {
    normal: string[];
    hidden?: string;
  };
  eggGroups?: string[];
  genderRate?: number;
  baseHappiness?: number;
  isBaby?: boolean;
  isLegendary?: boolean;
  isMythical?: boolean;
}

export interface SpeciesLearnset {
  levelUp: Record<string, string[]>;
  tm: string[];
  tutor: string[];
  egg: string[];
  event: string[];
}

export type VariantKind = "regional" | "permanent-form" | "battle-form";

export interface VariantData {
  id: string;
  baseSpecies: string;
  kind: VariantKind;
  name: string;
  category: string;
  sourceArtSlug: string;
  formSuffix: string;
  encounterEligible: boolean;
  eggEligible: boolean;
  typing?: string[];
  baseStatsOverride?: Partial<SpeciesData["baseStats"]>;
  learnsetOverride?: Partial<SpeciesLearnset>;
}

export interface MoveData {
  id: string;
  name: string;
  type: string;
  category: "physical" | "special" | "status";
  power: number;
  accuracy: number;
  pp: number;
  description: string;
  priority?: number;
  target?: string;
  meta?: {
    ailment?: string;
    ailmentChance?: number;
    critRate?: number;
    drain?: number;
    flinchChance?: number;
    healing?: number;
    statChance?: number;
    minHits?: number;
    maxHits?: number;
  };
  statChanges?: Array<{ stat: string; change: number }>;
}

export type EvolutionTrigger = "level-up" | "use-item" | "trade" | "other";

export type EvolutionTimeOfDay = "day" | "night";

export interface EvolutionConditionLevel {
  type: "level";
  level: number;
}

export interface EvolutionConditionItemUse {
  type: "item-use";
  item: string;
}

export interface EvolutionConditionFriendship {
  type: "friendship";
  min: number;
}

export interface EvolutionConditionHeldItem {
  type: "held-item";
  item: string;
}

export interface EvolutionConditionTime {
  type: "time";
  value: EvolutionTimeOfDay;
}

export interface EvolutionConditionTrade {
  type: "trade";
}

export interface EvolutionConditionRegion {
  type: "region";
  region: string;
}

export interface EvolutionConditionGender {
  type: "gender";
  value: "male" | "female";
}

export interface EvolutionConditionKnownMove {
  type: "known-move";
  moveId: string;
}

export interface EvolutionConditionKnownMoveType {
  type: "known-move-type";
  moveType: string;
}

export interface EvolutionConditionLocation {
  type: "location";
  location: string;
}

export interface EvolutionConditionStatCompare {
  type: "stat-compare";
  stat: "attack-vs-defense";
  op: "gt" | "eq" | "lt";
}

export interface EvolutionConditionPartyMember {
  type: "party-member";
  species?: string;
  pokemonType?: string;
}

export interface EvolutionConditionExtra {
  type: "extra";
  key: string;
  value: unknown;
}

export type EvolutionCondition =
  | EvolutionConditionLevel
  | EvolutionConditionItemUse
  | EvolutionConditionFriendship
  | EvolutionConditionHeldItem
  | EvolutionConditionTime
  | EvolutionConditionTrade
  | EvolutionConditionRegion
  | EvolutionConditionGender
  | EvolutionConditionKnownMove
  | EvolutionConditionKnownMoveType
  | EvolutionConditionLocation
  | EvolutionConditionStatCompare
  | EvolutionConditionPartyMember
  | EvolutionConditionExtra;

export interface EvolutionBranch {
  id: string;
  targetSpecies: string;
  targetVariantId?: string;
  trigger: EvolutionTrigger;
  conditions: EvolutionCondition[];
  consumeItem?: string | null;
}

export interface EvolutionData {
  branches: EvolutionBranch[];
}

export interface AbilityData {
  id: string;
  name: string;
  shortEffect: string;
  isMainSeries: boolean;
}

export type StatName = "attack" | "defense" | "spAttack" | "spDefense" | "speed";

export interface NatureData {
  id: string;
  name: string;
  increasedStat: StatName | null;
  decreasedStat: StatName | null;
}

export interface ItemData {
  id: string;
  name: string;
  category: string;
  cost: number;
  shortEffect: string;
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
