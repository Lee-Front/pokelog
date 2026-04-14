# Pokemon Mechanics Architecture

Generated: 2026-04-13
Updated: 2026-04-14

## Purpose

This document fixes the project direction before more Pokemon data is added.
The goal is to keep `species`, `evolution`, `forms`, and `battle-only transformations`
separate so the data model does not collapse later.

This is a design document, not an implementation checklist.

## Scope Decision

Current gameplay target:

- Base progression systems from the pre-Terastal / pre-Dynamax era
- Wild encounters, capture, party growth, learnsets, and evolution
- Permanent species and permanent variants that can exist outside battle

Now implemented:

- Mega Evolution (48 species, player-activated once per battle)
- Gigantamax (32 species, 3-turn duration, G-Max exclusive moves)
- Primal Reversion (2 species, auto-activates on battle start)
- Reversible form changes: item-based (20 species), battle-auto (11 species)
- Weather system (sun/rain/hail/sandstorm)
- Status conditions (primary: poison/burn/paralysis/sleep/freeze + volatile)
- Critical hits, STAB, stat stages

Still deferred:

- Terastalization (Gen 9 scope)
- Z-Moves
- Transform-style copy mechanics
- Fusion (Kyurem/Necrozma/Calyrex — excluded for now)

## Current Repo Reality

Relevant current files:

- [shared/types.ts](/C:/Users/dlwog/Desktop/project/pokelog/shared/types.ts:96)
- [packages/server/src/game/growth.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/growth.ts:1)
- [packages/server/src/game/battle.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/battle.ts:1)
- [data/pokemon/evolution.json](/C:/Users/dlwog/Desktop/project/pokelog/data/pokemon/evolution.json:1)
- [docs/pokemon-art-split.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-art-split.md:1)
- [docs/pokemon-species-scaffold.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-species-scaffold.md:1)

Current limitations:

- Evolution typing now supports branch data and the current runtime handles item-use plus several level-up context conditions, with pending choice flow for multi-branch cases. `region` conditions now read real user state, `location` conditions are approximated through region aliases, `extra.min_affection` is approximated through friendship, `extra.used_move` / `extra.min_move_count` are supported through per-Pokemon move usage counters populated by battle actions, and trade branches now resolve through a dedicated player-to-player trade flow. Only a smaller set of `extra` families are still deferred. Pokemon detail now exposes branch diagnostics so blocked versus deferred evolutions are visible instead of silent, and tracked move-usage branches now show progress-aware blocker text.
- `OwnedPokemon` now contains: gender, nature, isShiny, held item, friendship, ability, move-usage counters, cumulative damage-taken, statusCondition, sleepTurns, variantId, hasGigantamaxFactor.
- `variantId` is actively used: regional variant encounters create pokemon with variantId, item-based form changes update it, battle transformations set temporary battleForm.
- `WildPokemon` now includes: nature, gender, ability, isShiny, variantId. Captured wild pokemon preserve all these fields via `wildPokemonToOwned`.
- Multiplayer trade uses interactive TUI with accept/reject/cancel flow. Trade-lock feature was removed (not in original games). Trade records archived instead of dropped at 200 limit.
- Encounter pools cover 100% of 905 species across 10 regions. Regional variants included in home regions. Weight system: common 60-80, starters 3-10, legendaries 2, mythicals 1.
- Egg gacha tiers: common 120P, rare 450P, legend 3200P. Regional variants are egg-eligible.
- Runtime now has a dedicated `variants.json` table derived from the art split, but variant overrides and variant-target evolution resolution are not populated yet.
- Battle code now supports temporary transformations: Mega Evolution (playerBattleForm + transformationUsed), Gigantamax (3-turn countdown + HP multiplier), Primal Reversion (auto on battle start). All revert on battle end.
- Battle code includes: weather system (4 types, 5-turn duration), status conditions (primary persists after battle, volatile clears), stat stages (-6 to +6), critical hits, STAB, drain/healing/flinch meta effects.
- The art split already shows that raw art slugs contain both base species and special forms, so they cannot be treated as one flat list.

## Core Domain Separation

The project should treat the following as different systems:

### 1. Base Species

Canonical species such as `pikachu`, `bulbasaur`, `mr-mime`, `ho-oh`.

This layer owns:

- National identifier
- Display name
- Default typing
- Base stats
- Catch rate
- Exp group
- Learnset access

This is the main runtime species list for the project.

### 2. Permanent Variant

A permanent variant is not a temporary battle state.
It exists outside battle and can affect encounter pools, learnsets, evolution, stats, and typing.

Examples:

- Regional forms
- Fixed alternate forms that are effectively separate world-state variants

These should not be mixed with battle-only systems.

Examples that belong here:

- `vulpix-alola`
- `meowth-galar`
- `growlithe-hisui`

### 3. Evolution

Evolution changes one owned Pokemon into another species or variant target.
This is a progression system, not a form toggle.

Evolution must support branches instead of a single `evolvesTo`.

Required condition families to plan for:

- Level
- Item use
- Friendship
- Trade
- Held item
- Time of day
- Region or location
- Gender
- Stat comparison
- Known move
- Party requirement

Not every condition needs to be implemented immediately, but the schema must not block them.

### 4. Reversible Form Change

This is still the same species, but the active form can change.
It is not an evolution.

Examples:

- `castform`
- `rotom`
- `aegislash`
- `wishiwashi`

These forms need their own rule system later, but they should not pollute the evolution table.

### 5. Battle-only Transformation

These are temporary states applied during battle and removed after battle.

Examples:

- Mega Evolution
- Dynamax / Gigantamax
- Terastalization

This project is not implementing them now.
Still, the battle state model should leave space for them later.

### 6. Transform Copy Mechanics

This is a move effect system, not species data and not evolution.

Examples:

- `Transform`
- Similar copy or disguise mechanics

This belongs to move-effect logic later.

## First Functional Boundary

The first functional milestone should include only:

- Base species
- Permanent variants only when they matter outside battle
- Learnsets
- Evolution
- Standard battle and capture systems
- Region-based encounters and region-independent egg gacha

The first milestone should not include:

- Mega Evolution
- Dynamax / Gigantamax
- Terastalization
- Transform copy mechanics
- Battle-only form systems

## Recommended Data Model Direction

### Species

`SpeciesData` remains the canonical base entry.

It should describe only what is always true for that species baseline.

### Learnset

Learnset is already moving in the right direction:

- `levelUp`
- `tm`
- `tutor`
- `egg`
- `event`

This should stay separate from move definitions in `moves.json`.

### Variant

Add a future `VariantData` layer instead of overloading `SpeciesData`.

Current implementation status:

- a dedicated `VariantData` table now exists at `data/pokemon/variants.json`
- the loader now exposes runtime accessors for variants
- `OwnedPokemon.variantId` is now reserved in runtime state
- override fields are still placeholders and not yet populated from PokeAPI or curated data

Recommended shape:

```ts
interface VariantData {
  id: string;
  baseSpecies: string;
  kind: "regional" | "permanent-form" | "battle-form";
  name: string;
  typing?: string[];
  baseStatsOverride?: Partial<SpeciesData["baseStats"]>;
  learnsetOverride?: Partial<SpeciesLearnset>;
  encounterEligible: boolean;
  eggEligible: boolean;
}
```

Rules:

- `battle-form` variants exist in data but are not encounterable
- regional and permanent world variants may be encounterable
- battle-only transformations should never be added to normal encounter pools

### Evolution

Replace the current single-target model with branch-based evolution.

Recommended direction:

```ts
interface EvolutionBranch {
  targetSpecies: string;
  targetVariantId?: string;
  conditions: EvolutionCondition[];
}

interface SpeciesEvolutionData {
  branches: EvolutionBranch[];
}
```

Condition families to reserve:

- `level`
- `item-use`
- `friendship`
- `trade`
- `held-item`
- `time`
- `region`
- `gender`
- `known-move`
- `stat-compare`
- `party-member`

### Owned Pokemon

`OwnedPokemon` will need more state before advanced evolution and forms work correctly.

Fields to reserve next:

- `variantId?: string | null`
- `heldItem?: string | null`
- `friendship?: number`
- `abilityId?: string | null`
- `flags?: Record<string, boolean>`

This is enough to keep future form and evolution work from becoming a rewrite.

### Battle State

When battle-only systems are introduced later, they should live under battle state, not owned species identity.

Recommended future direction:

```ts
interface ActiveTransformationState {
  type: "mega" | "gigantamax" | "terastal";
  source: string;
}
```

For now, do not implement this.
Only reserve the concept in design.

## Art and Data Policy

Use the split generated in [docs/pokemon-art-split.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-art-split.md:1).

Rules:

- `baseSpeciesSlugs` is the default workset for runtime species data
- `specialForms` must stay out of normal encounter and egg pools
- Special forms are added only when their dedicated mechanic exists
- PokeAPI-specific fetch aliases must stay in a separate mapping file instead of renaming art slugs

Current fetch alias policy:

- Use [pokemon-pokeapi-sync-status.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-pokeapi-sync-status.md:1) as the operational reference
- Keep raw art slugs stable
- Keep runtime base species slugs stable
- Map only external `pokemon/{slug}` fetch exceptions through `data/pokemon/pokeapi-species-aliases.json`

This prevents bad outcomes such as:

- `charizard-mega-x` appearing as a normal wild Pokemon
- `venusaur-gmax` hatching from a standard egg
- `aegislash-blade` being treated as a separate species instead of a form state

## Recommended Implementation Order

1. Finish species, moves, and evolution data for `baseSpeciesSlugs`
2. Expand evolution schema to branch conditions
3. Add `variantId`, held item, and friendship to owned Pokemon
4. Introduce permanent regional variants into actual encounter/evolution flows
5. Add reversible form systems
6. Add battle-only transformation systems later

## Project Decision Summary

- Runtime species progression is based on base species first
- Permanent variants are a separate data layer
- Evolution is progression, not form change
- Reversible forms are not evolution
- Battle-only transformations are deferred
- Tera and Gigantamax are intentionally not in the first implementation scope

## External References

These sources were used to check the mechanic boundaries:

- Evolution overview: https://bulbapedia.bulbagarden.net/wiki/Evolution
- Forme change overview: https://bulbapedia.bulbagarden.net/wiki/Forme_change
- Mega Evolution: https://bulbapedia.bulbagarden.net/wiki/Mega_evolutions
- Gigantamax / Gigantamax Factor: https://bulbapedia.bulbagarden.net/wiki/Gigantamaxing
- Aegislash stance change example: https://bulbapedia.bulbagarden.net/wiki/Stance_Change_%28Ability%29
