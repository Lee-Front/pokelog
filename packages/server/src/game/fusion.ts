import crypto from "node:crypto";
import type { OwnedPokemon, UserData } from "../../../../shared/types.js";
import { getSpeciesByName } from "./data-loader.js";
import { buildStatsForPokemon } from "./pokemon-stats.js";

/**
 * Fusion system (Kyurem / Necrozma / Calyrex).
 *
 * Canonical behavior:
 *  - Fusing a base (kyurem / necrozma / calyrex) with a partner (reshiram / zekrom /
 *    solgaleo / lunala / glastrier / spectrier) using the appropriate item produces
 *    an independent species form (kyurem-white, kyurem-black, necrozma-dusk,
 *    necrozma-dawn, calyrex-ice, calyrex-shadow).
 *  - The partner's full OwnedPokemon snapshot is stored on the base as
 *    `fusedPartnerData` so that unfusing can restore it.
 *  - Items are NOT consumed on fuse (canon: DNA Splicer / N-Solarizer etc. are reusable).
 *  - Stats/maxHp are recomputed for the fused species; HP ratio is preserved.
 *  - Moves merge: base moves first, then unique partner moves, capped at 4.
 *  - Ability is overridden per recipe (signature ability of the fused form).
 */

export interface FusionRecipe {
  base: string;
  partner: string;
  item: string;
  result: string;
  /** Signature ability of the fused form. */
  abilityOverride?: string;
}

// NOTE: The species slugs here must match entries present in data/pokemon/species.json.
// In this dataset the Necrozma / Calyrex fused forms are `necrozma-dusk`,
// `necrozma-dawn`, `calyrex-ice`, `calyrex-shadow` (not `-dusk-mane` / `-dawn-wings` /
// `-ice-rider` / `-shadow-rider`).
export const FUSION_RECIPES: FusionRecipe[] = [
  {
    base: "kyurem",
    partner: "reshiram",
    item: "dna-splicers",
    result: "kyurem-white",
    abilityOverride: "turboblaze",
  },
  {
    base: "kyurem",
    partner: "zekrom",
    item: "dna-splicers",
    result: "kyurem-black",
    abilityOverride: "teravolt",
  },
  {
    base: "necrozma",
    partner: "solgaleo",
    item: "n-solarizer",
    result: "necrozma-dusk",
    abilityOverride: "prism-armor",
  },
  {
    base: "necrozma",
    partner: "lunala",
    item: "n-lunarizer",
    result: "necrozma-dawn",
    abilityOverride: "prism-armor",
  },
  {
    base: "calyrex",
    partner: "glastrier",
    item: "reins-of-unity",
    result: "calyrex-ice",
    abilityOverride: "as-one-glastrier",
  },
  {
    base: "calyrex",
    partner: "spectrier",
    item: "reins-of-unity",
    result: "calyrex-shadow",
    abilityOverride: "as-one-spectrier",
  },
];

export interface FusionResult {
  ok: boolean;
  error?: string;
  fusedPokemon?: OwnedPokemon;
}

export function findRecipe(
  baseSpecies: string,
  partnerSpecies: string,
  itemId: string,
): FusionRecipe | null {
  return (
    FUSION_RECIPES.find(
      (r) => r.base === baseSpecies && r.partner === partnerSpecies && r.item === itemId,
    ) ?? null
  );
}

export function findUnfuseRecipe(fusedSpecies: string): FusionRecipe | null {
  return FUSION_RECIPES.find((r) => r.result === fusedSpecies) ?? null;
}

export function fusePokemon(
  user: UserData,
  baseUid: string,
  partnerUid: string,
  itemId: string,
): FusionResult {
  const base = user.pokemon.find((p) => p.uid === baseUid);
  const partner = user.pokemon.find((p) => p.uid === partnerUid);
  if (!base || !partner) {
    return { ok: false, error: "포켓몬을 찾을 수 없습니다" };
  }
  if (base.uid === partner.uid) {
    return { ok: false, error: "같은 포켓몬끼리는 합체할 수 없습니다" };
  }
  if (base.fusedPartnerData) {
    return { ok: false, error: "이미 합체된 포켓몬입니다" };
  }

  const recipe = findRecipe(base.species, partner.species, itemId);
  if (!recipe) {
    return { ok: false, error: "합체 조합이 아닙니다" };
  }

  if ((user.inventory[itemId] ?? 0) <= 0) {
    return { ok: false, error: "아이템이 없습니다" };
  }

  const resultData = getSpeciesByName(recipe.result);
  if (!resultData) {
    return { ok: false, error: "합체 폼 데이터가 없습니다" };
  }

  // Snapshot partner before transforming base
  base.fusedPartnerData = {
    species: partner.species,
    level: partner.level,
    stats: { ...partner.stats },
    moves: partner.moves.map((m) => ({ ...m })),
    abilityId: partner.abilityId ?? null,
    nature: partner.nature,
    heldItem: partner.heldItem ?? null,
    gender: partner.gender ?? null,
  };
  base.fusedPartnerUid = partner.uid;

  // Transform base → fused species
  base.species = recipe.result;

  // Recompute stats for the fused form; preserve HP ratio.
  const previousMaxHp = base.maxHp > 0 ? base.maxHp : 1;
  const hpRatio = Math.max(0, Math.min(1, base.hp / previousMaxHp));
  const { maxHp, stats } = buildStatsForPokemon(base);
  base.maxHp = maxHp;
  base.hp = Math.max(1, Math.floor(hpRatio * maxHp));
  base.stats = stats;

  // Merge moves: base first, then unique partner moves, capped at 4.
  const moveIds = new Set(base.moves.map((m) => m.id));
  for (const m of partner.moves) {
    if (base.moves.length >= 4) break;
    if (!moveIds.has(m.id)) {
      base.moves.push({ ...m });
      moveIds.add(m.id);
    }
  }

  if (recipe.abilityOverride) {
    base.abilityId = recipe.abilityOverride;
  }

  // Remove partner from party/storage; canon item is not consumed.
  user.pokemon = user.pokemon.filter((p) => p.uid !== partnerUid);
  user.storage = user.storage.filter((p) => p.uid !== partnerUid);
  if (user.party.includes(partnerUid)) {
    user.party = user.party.filter((uid) => uid !== partnerUid);
  }

  return { ok: true, fusedPokemon: base };
}

export function unfusePokemon(user: UserData, fusedUid: string): FusionResult {
  const fused = user.pokemon.find((p) => p.uid === fusedUid);
  if (!fused) {
    return { ok: false, error: "포켓몬을 찾을 수 없습니다" };
  }
  if (!fused.fusedPartnerData) {
    return { ok: false, error: "합체된 포켓몬이 아닙니다" };
  }

  const recipe = findUnfuseRecipe(fused.species);
  if (!recipe) {
    return { ok: false, error: "해제 조합을 찾을 수 없습니다" };
  }

  const partnerSnapshot = fused.fusedPartnerData;
  const partnerUid = fused.fusedPartnerUid ?? crypto.randomUUID();

  // Restore base species (kyurem / necrozma / calyrex) and recompute stats.
  fused.species = recipe.base;
  const previousMaxHp = fused.maxHp > 0 ? fused.maxHp : 1;
  const hpRatio = Math.max(0, Math.min(1, fused.hp / previousMaxHp));
  const { maxHp, stats } = buildStatsForPokemon(fused);
  fused.maxHp = maxHp;
  fused.hp = Math.max(1, Math.floor(hpRatio * maxHp));
  fused.stats = stats;
  // Restore the default first-ability of the base species (canon: Kyurem → Pressure, etc.).
  const baseSpeciesData = getSpeciesByName(recipe.base);
  fused.abilityId = baseSpeciesData?.abilities?.normal[0] ?? null;

  // Reconstruct partner as a standalone OwnedPokemon. Rebuild its stats/maxHp
  // from the stored species/level so they're correct at unfuse time.
  const partner: OwnedPokemon = {
    uid: partnerUid,
    species: partnerSnapshot.species,
    variantId: null,
    nickname: null,
    level: partnerSnapshot.level,
    exp: 0,
    hp: 1,
    maxHp: 1,
    stats: { ...partnerSnapshot.stats },
    moves: partnerSnapshot.moves.map((m) => ({ ...m })),
    caughtAt: new Date().toISOString(),
    gender: partnerSnapshot.gender ?? null,
    friendship: 70,
    heldItem: partnerSnapshot.heldItem ?? null,
    abilityId: partnerSnapshot.abilityId ?? null,
    moveUsageCounts: {},
    damageTakenTotal: 0,
    nature: partnerSnapshot.nature ?? "hardy",
    isShiny: false,
    statusCondition: null,
  };
  const partnerStats = buildStatsForPokemon(partner);
  partner.maxHp = partnerStats.maxHp;
  partner.hp = partnerStats.maxHp;
  partner.stats = partnerStats.stats;

  user.pokemon.push(partner);

  // Clear fusion data from base
  fused.fusedPartnerData = undefined;
  fused.fusedPartnerUid = undefined;

  return { ok: true, fusedPokemon: fused };
}
