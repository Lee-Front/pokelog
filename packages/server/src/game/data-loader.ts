import { readdirSync, readFileSync } from "node:fs";
import { projectPath } from "../paths.js";
import type {
  AbilityData,
  EvolutionBranch,
  EvolutionCondition,
  EvolutionData,
  ItemData,
  MoveData,
  NatureData,
  RegionData,
  SpeciesData,
  SpeciesLearnset,
  VariantData,
} from "../../../../shared/types.js";

type TypeChart = Record<string, Record<string, number>>;
type LegacyLevelUpLearnset = Record<string, string[]>;
type LegacyEvolutionData = {
  evolvesTo: string | null;
  condition:
    | { type: "level"; level: number }
    | { type: "item"; item: string }
    | null;
};
type RawSpeciesData = Omit<SpeciesData, "learnset"> & {
  learnset: SpeciesLearnset | LegacyLevelUpLearnset;
};
type RawMoveData = MoveData;
type RawEvolutionEntry = EvolutionData | LegacyEvolutionData;
type CatchRateOverrides = Record<string, number>;
type RawRegionData = RegionData;
type RawVariantData = VariantData;

let speciesCache: SpeciesData[] | null = null;
let movesCache: MoveData[] | null = null;
let typeChartCache: TypeChart | null = null;
let evolutionCache: Record<string, EvolutionData> | null = null;
let abilitiesCache: AbilityData[] | null = null;
let naturesCache: NatureData[] | null = null;
let itemsCache: ItemData[] | null = null;
let variantsCache: VariantData[] | null = null;
let catchRateOverrideCache: CatchRateOverrides | null = null;
const regionCache = new Map<string, RegionData>();

function readJsonFile<T>(relativePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(projectPath(relativePath), "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function isStructuredLearnset(learnset: SpeciesLearnset | LegacyLevelUpLearnset): learnset is SpeciesLearnset {
  const candidate = learnset as Partial<SpeciesLearnset>;
  return Array.isArray(candidate.tm)
    && Array.isArray(candidate.tutor)
    && Array.isArray(candidate.egg)
    && Array.isArray(candidate.event)
    && typeof candidate.levelUp === "object"
    && candidate.levelUp !== null;
}

function normalizeLearnset(learnset: SpeciesLearnset | LegacyLevelUpLearnset | undefined): SpeciesLearnset {
  if (!learnset) {
    return { levelUp: {}, tm: [], tutor: [], egg: [], event: [] };
  }

  if (isStructuredLearnset(learnset)) {
    return {
      levelUp: learnset.levelUp ?? {},
      tm: learnset.tm ?? [],
      tutor: learnset.tutor ?? [],
      egg: learnset.egg ?? [],
      event: learnset.event ?? [],
    };
  }

  return {
    levelUp: learnset,
    tm: [],
    tutor: [],
    egg: [],
    event: [],
  };
}

function normalizeSpeciesEntry(entry: RawSpeciesData, overrides: CatchRateOverrides): SpeciesData {
  const rawCaptureRate = entry.rawCaptureRate ?? Math.round(entry.catchRate * 255);
  const overriddenCatchRate = overrides[entry.species];

  return {
    ...entry,
    catchRate: overriddenCatchRate ?? entry.catchRate,
    rawCaptureRate,
    baseExpYield: entry.baseExpYield ?? 0,
    abilities: {
      normal: entry.abilities?.normal ?? [],
      hidden: entry.abilities?.hidden,
    },
    eggGroups: entry.eggGroups ?? [],
    genderRate: entry.genderRate ?? -1,
    baseHappiness: entry.baseHappiness ?? 70,
    isBaby: entry.isBaby ?? false,
    isLegendary: entry.isLegendary ?? false,
    isMythical: entry.isMythical ?? false,
    learnset: normalizeLearnset(entry.learnset),
  };
}

function normalizeMoveData(entry: RawMoveData): MoveData {
  return {
    ...entry,
    priority: entry.priority ?? 0,
    target: entry.target ?? "selected-pokemon",
    meta: entry.meta ?? {},
    statChanges: entry.statChanges ?? [],
  };
}

function isBranchEvolution(entry: RawEvolutionEntry): entry is EvolutionData {
  return Array.isArray((entry as EvolutionData).branches);
}

function normalizeLegacyCondition(
  condition: LegacyEvolutionData["condition"],
): { trigger: EvolutionBranch["trigger"]; condition: EvolutionCondition } | null {
  if (!condition) {
    return null;
  }

  if (condition.type === "level") {
    return {
      trigger: "level-up",
      condition: { type: "level", level: condition.level },
    };
  }

  return {
    trigger: "use-item",
    condition: { type: "item-use", item: condition.item },
  };
}

function normalizeEvolutionEntry(species: string, entry: RawEvolutionEntry | undefined): EvolutionData {
  if (!entry) {
    return { branches: [] };
  }

  if (isBranchEvolution(entry)) {
    return {
      branches: entry.branches.map((branch, index) => ({
        id: branch.id || `${species}-${branch.targetSpecies}-${index + 1}`,
        trigger: branch.trigger ?? "other",
        targetSpecies: branch.targetSpecies,
        targetVariantId: branch.targetVariantId,
        conditions: branch.conditions ?? [],
        consumeItem: branch.consumeItem ?? null,
      })),
    };
  }

  if (!entry.evolvesTo) {
    return { branches: [] };
  }

  const normalizedCondition = normalizeLegacyCondition(entry.condition);
  if (!normalizedCondition) {
    return { branches: [] };
  }

  return {
    branches: [
      {
        id: `${species}-${entry.evolvesTo}-1`,
        targetSpecies: entry.evolvesTo,
        trigger: normalizedCondition.trigger,
        conditions: [normalizedCondition.condition],
        consumeItem: normalizedCondition.condition.type === "item-use"
          ? normalizedCondition.condition.item
          : null,
      },
    ],
  };
}

function isValidEncounterSpecies(species: string): boolean {
  if (getSpeciesByName(species)) return true;
  // variant slug도 유효 — 베이스 종이 존재하면 OK
  const variant = getVariants().find((v) => v.id === species);
  if (variant && getSpeciesByName(variant.baseSpecies)) return true;
  return false;
}

function normalizeRegionEntry(entry: RegionData["encounters"][number]): RegionData["encounters"][number] | null {
  if (!entry?.species || !isValidEncounterSpecies(entry.species)) {
    return null;
  }

  const [minLevel, maxLevel] = entry.levelRange ?? [1, 1];
  const normalizedMinLevel = Math.max(1, Number(minLevel) || 1);
  const normalizedMaxLevel = Math.max(normalizedMinLevel, Number(maxLevel) || normalizedMinLevel);
  const weight = Math.max(1, Number(entry.weight) || 1);

  return {
    species: entry.species,
    weight,
    levelRange: [normalizedMinLevel, normalizedMaxLevel],
  };
}

function normalizeRegionData(name: string, data: RawRegionData): RegionData {
  const encounters = Array.isArray(data?.encounters)
    ? data.encounters
      .map((entry) => normalizeRegionEntry(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : [];

  if (encounters.length === 0) {
    throw new Error(`Region '${name}' has no valid encounters.`);
  }

  return {
    name: data?.name || name,
    encounters,
  };
}

function normalizeVariantData(entry: RawVariantData): VariantData {
  return {
    ...entry,
    encounterEligible: entry.encounterEligible ?? false,
    eggEligible: entry.eggEligible ?? false,
    typing: entry.typing ?? undefined,
    baseStatsOverride: entry.baseStatsOverride ?? undefined,
    learnsetOverride: entry.learnsetOverride ?? undefined,
  };
}

export function getSpecies(): SpeciesData[] {
  if (!speciesCache) {
    const rawSpecies = readJsonFile<RawSpeciesData[]>("data/pokemon/species.json", []);
    const overrides = getCatchRateOverrides();
    speciesCache = rawSpecies.map((entry) => normalizeSpeciesEntry(entry, overrides));
  }
  return speciesCache!;
}

let speciesAliasCache: Record<string, string> | null = null;

function getSpeciesAliases(): Record<string, string> {
  if (!speciesAliasCache) {
    speciesAliasCache = readJsonFile<Record<string, string>>("data/pokemon/pokeapi-species-aliases.json", {});
  }
  return speciesAliasCache!;
}

export function getSpeciesByName(species: string): SpeciesData | undefined {
  const all = getSpecies();
  const exact = all.find((s) => s.species === species);
  if (exact) return exact;

  // alias 조회: "aegislash" → "aegislash-shield"
  const aliases = getSpeciesAliases();
  const aliased = aliases[species];
  if (aliased) return all.find((s) => s.species === aliased);

  return undefined;
}

export function getMoves(): MoveData[] {
  if (!movesCache) {
    const rawMoves = readJsonFile<RawMoveData[]>("data/moves/moves.json", []);
    movesCache = rawMoves.map(normalizeMoveData);
  }
  return movesCache!;
}

export function getMoveById(id: string): MoveData | undefined {
  return getMoves().find((m) => m.id === id);
}

export function getTypeChart(): TypeChart {
  if (!typeChartCache) {
    typeChartCache = readJsonFile<TypeChart>("data/types/type-chart.json", {});
  }
  return typeChartCache!;
}

export function getEvolutions(): Record<string, EvolutionData> {
  if (!evolutionCache) {
    const rawEvolutions = readJsonFile<Record<string, RawEvolutionEntry>>("data/pokemon/evolution.json", {});
    evolutionCache = Object.fromEntries(
      Object.entries(rawEvolutions).map(([species, entry]) => [species, normalizeEvolutionEntry(species, entry)]),
    );
  }
  return evolutionCache!;
}

export function getAbilities(): AbilityData[] {
  if (!abilitiesCache) {
    abilitiesCache = readJsonFile<AbilityData[]>("data/abilities/abilities.json", []);
  }
  return abilitiesCache!;
}

export function getNatures(): NatureData[] {
  if (!naturesCache) {
    naturesCache = readJsonFile<NatureData[]>("data/natures/natures.json", []);
  }
  return naturesCache!;
}

export function getItems(): ItemData[] {
  if (!itemsCache) {
    itemsCache = readJsonFile<ItemData[]>("data/items/items.json", []);
  }
  return itemsCache!;
}

export function getVariants(): VariantData[] {
  if (!variantsCache) {
    const rawVariants = readJsonFile<RawVariantData[]>("data/pokemon/variants.json", []);
    variantsCache = rawVariants.map(normalizeVariantData);
  }
  return variantsCache!;
}

export function getVariantById(id: string): VariantData | undefined {
  return getVariants().find((variant) => variant.id === id);
}

export function getVariantsByBaseSpecies(baseSpecies: string): VariantData[] {
  return getVariants().filter((variant) => variant.baseSpecies === baseSpecies);
}

export function getItemById(id: string): ItemData | undefined {
  return getItems().find((item) => item.id === id);
}

export function getNatureById(id: string): NatureData | undefined {
  return getNatures().find((n) => n.id === id);
}

export function getCatchRateOverrides(): CatchRateOverrides {
  if (!catchRateOverrideCache) {
    catchRateOverrideCache = readJsonFile<CatchRateOverrides>("data/pokemon/catch-rate-overrides.json", {});
  }
  return catchRateOverrideCache!;
}

export function getRegion(name: string): RegionData {
  if (!regionCache.has(name)) {
    const raw = readJsonFile<RawRegionData | null>(`data/regions/${name}.json`, null);
    if (!raw) {
      throw new Error(`Region not found: ${name}`);
    }
    regionCache.set(name, normalizeRegionData(name, raw));
  }
  return regionCache.get(name)!;
}

export function getRegionNames(): string[] {
  try {
    return readdirSync(projectPath("data/regions"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function getAllSpeciesList(): Array<{ id: number; species: string; name: string }> {
  return getSpecies().map((s) => ({ id: s.id, species: s.species, name: s.name }));
}

export function clearAllCaches(): void {
  speciesCache = null;
  movesCache = null;
  typeChartCache = null;
  evolutionCache = null;
  abilitiesCache = null;
  naturesCache = null;
  itemsCache = null;
  variantsCache = null;
  catchRateOverrideCache = null;
  speciesAliasCache = null;
  regionCache.clear();
}
