# Pokemon Mechanics Architecture

Updated: 2026-04-14

## Purpose

This document defines the domain boundaries for Pokemon gameplay systems.

The project should keep these concerns separate:

- base species
- permanent variants
- evolution
- reversible form change
- battle-only transformation
- transform/copy mechanics

This is an architecture reference, not a backlog checklist.

## Current Scope

Current gameplay baseline includes:

- wild encounters
- capture
- party growth
- learnsets
- branch-based evolution
- region-based encounter pools
- egg gacha
- held items
- multiplayer trade

Current advanced mechanics already implemented:

- Mega Evolution
- Gigantamax
- Primal Reversion
- item-based form change
- battle-auto form change
- weather
- status conditions
- stat stages
- crit and STAB

Still deferred:

- Terastallization
- Z-Moves
- Transform-style copy mechanics
- fusion forms

## Current Repo Reality

Shared Pokemon state/runtime now exists in:

- [packages/server/src/game/pokemon-state.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-state.ts:1)
- [packages/server/src/game/pokemon-stats.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-stats.ts:1)
- [packages/server/src/game/pokemon-factory.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-factory.ts:1)
- [packages/server/src/game/growth.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/growth.ts:1)

Current shared runtime behavior:

- `OwnedPokemon` contains `variantId`, held item, friendship, status state, and Gigantamax-factor state
- `WildPokemon` contains `variantId`, nature, gender, ability, and shiny state
- wild-to-owned capture preserves variant and identity fields
- effective typing now resolves through the shared variant resolver
- effective base stat calculation now resolves through the shared stat pipeline
- battle transformations use temporary `battleForm`

Current battle transformation status:

- Mega Evolution: player-activated, once per battle
- Gigantamax: time-limited battle transformation with HP scaling
- Primal Reversion: activates automatically for supported species
- all three revert on battle end

## Core Domain Separation

### 1. Base Species

Canonical species such as `pikachu`, `bulbasaur`, `mr-mime`, `ho-oh`.

This layer owns:

- species identity
- display name
- default typing
- default base stats
- catch rate
- exp group
- learnset baseline

### 2. Permanent Variant

A permanent variant exists outside battle.

It can affect:

- encounter pools
- egg rolls
- typing
- base stats
- evolution targets
- display identity

Examples:

- `vulpix-alola`
- `meowth-galar`
- `growlithe-hisui`

This is not the same as a battle-only form.

### 3. Evolution

Evolution is progression, not a form toggle.

Current branch system must support:

- level
- item use
- friendship
- trade
- held item
- time of day
- region or location substitute
- gender
- stat comparison
- known move
- party requirement

The runtime already supports a meaningful subset of these and stores pending evolutions when multiple branches match.

### 4. Reversible Form Change

This is still the same species and not an evolution.

Examples:

- `castform`
- `rotom`
- `aegislash`
- `wishiwashi`

These forms need their own rules and should not be flattened into the evolution table.

### 5. Battle-only Transformation

These are temporary battle states that must revert after battle.

Examples:

- Mega Evolution
- Gigantamax
- Primal Reversion
- Terastallization

These belong to battle state, not owned-species identity.

### 6. Transform Copy Mechanics

This is move-effect logic, not species data.

Examples:

- `Transform`
- copy/disguise systems

This remains deferred.

## Current Data and Runtime Direction

### Species

`SpeciesData` remains the canonical base entry.

### Variant

The project now has a real `VariantData` layer:

- [data/pokemon/variants.json](/C:/Users/dlwog/Desktop/project/pokelog/data/pokemon/variants.json:1)

Current rule:

- `variantId` represents permanent world identity
- `battleForm` represents temporary battle-time override
- shared runtime helpers must resolve effective state instead of ad-hoc checks in each feature

### Stats

Stat calculation should go through:

- [packages/server/src/game/pokemon-stats.ts](/C:/Users/dlwog/Desktop/project/pokelog/packages/server/src/game/pokemon-stats.ts:1)

This pipeline is responsible for:

- level scaling
- nature modifier
- variant base stat override
- temporary battle-form override

### Evolution

Branch-based evolution remains the correct model.

The project already uses pending choice flow when multiple branches match.

### Battle State

Battle-only transformations belong in battle runtime, not permanent Pokemon identity.

The route layer still needs more decomposition, but the direction is already clear:

- route/controller layer
- battle engine/state mutation layer
- shared Pokemon identity/stat helpers

## Current Architectural Debt

The main remaining debt is not the data model.
It is runtime consolidation.

Most important remaining work:

1. Split the oversized battle route into engine/state layers.
2. Keep all typing/stat resolution on the shared `pokemon-state` and `pokemon-stats` modules.
3. Keep held-item, evolution-context, and form-state rules moving toward shared services instead of route-local logic.

## Project Decision Summary

- base species remain canonical
- permanent variants are a separate data layer
- evolution is progression, not form change
- reversible forms are not evolution
- battle-only transformations are temporary battle state
- transform/copy mechanics are still deferred
- Terastalization and fusion forms are intentionally out of current scope
