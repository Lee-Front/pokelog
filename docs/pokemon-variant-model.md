# Pokemon Variant Model

Updated: 2026-04-14

## Purpose

This document records the current runtime variant layer.

The goal is to keep these separate:

- base species
- permanent world variants
- reversible form states
- battle-only transformation states

without collapsing everything back into `species.json`.

## Current Runtime

Variant data is stored in:

- [data/pokemon/variants.json](/C:/Users/dlwog/Desktop/project/pokelog/data/pokemon/variants.json:1)

Runtime access lives in:

- [packages/server/src/game/data-loader.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/data-loader.ts:1)
- [packages/server/src/game/pokemon-state.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-state.ts:1)
- [packages/server/src/game/pokemon-stats.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-stats.ts:1)

The variant layer is no longer just reserved data.

Current runtime behavior:

- regional variant encounters instantiate `variantId`
- regional variant eggs instantiate `variantId` (egg-eligible variants are added to the egg gacha pool of their base species)
- wild Pokemon preserve `variantId`, nature, gender, ability, and shiny state
- captured Pokemon preserve `variantId`
- hatched Pokemon preserve `variantId`
- item-based form changes can update `variantId`
- battle transformations use temporary `battleForm`
- effective typing now resolves through the variant layer
- effective base stat overrides now resolve through the variant layer

## Current Variant Schema

```ts
type VariantKind = "regional" | "permanent-form" | "battle-form";

interface VariantData {
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
```

## Effective Pokemon Resolution

The runtime now treats a Pokemon identity as:

- base species
- optional permanent `variantId`
- optional temporary `battleForm`

The shared resolver is:

- [packages/server/src/game/pokemon-state.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-state.ts:1)

Current rule:

- `battleForm` overrides `variantId` for battle-time effective state
- `variantId` overrides base-species typing and base stat data when variant overrides exist
- display and stat calculations should consume the shared resolver instead of rebuilding this logic per feature

## Eligibility Policy

Current policy remains:

- `battle-form` variants are never normal encounter entries
- `battle-form` variants are never normal egg entries
- regional variants are normal encounter candidates in their home-region pools
- regional variants are egg-eligible, but only enter an egg tier when their base species is itself a base-stage member of that tier; variant egg weight is scaled to 25% of the base species weight so the standard form stays dominant
- permanent-form variants remain opt-in and mechanic-driven

## What Changed From The Older Plan

These older statements are no longer true:

- "`variantId` is only reserved"
- "encounter and egg flows do not instantiate variants"
- "typing/base stat overrides are placeholders only"

Current code already uses the variant layer in active gameplay.

## Remaining Gaps

Still incomplete:

- `learnsetOverride` is not yet a major runtime path
- `targetVariantId` evolution targets are not broadly used yet
- cosmetic/pattern forms are still mostly data-only
- the battle route still needs a larger engine split even though the variant resolver is already shared

## Next Work

1. Keep all typing/stat resolution on top of `pokemon-state.ts` and `pokemon-stats.ts`.
2. Add broader `targetVariantId` evolution coverage where a branch should resolve into a non-default form.
3. Decide which permanent-form variants should become explicit world mechanics instead of remaining data-only.
