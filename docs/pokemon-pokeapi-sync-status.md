# Pokemon PokeAPI Sync Status

Generated: 2026-04-13

## Purpose

This document records the current operational state of the PokeAPI sync pipeline.

It is not the original design spec.
It exists to answer three practical questions:

- what the sync currently produces
- how slug mismatches are handled
- what is still intentionally deferred

## Current Output

The current sync pipeline has been executed and generated the following tracked runtime data:

- `data/pokemon/species.json`: 905 species
- `data/pokemon/evolution.json`: 905 evolution entries
- `data/moves/moves.json`: 937 moves
- `data/abilities/abilities.json`: 371 abilities
- `data/natures/natures.json`: 25 natures
- `data/items/items.json`: 143 items

Related support files:

- `data/pokemon/catch-rate-overrides.json`
- `data/pokemon/pokeapi-species-aliases.json`
- `data/pokemon/variants.json`

## Sync Command

Primary command:

```bash
npm run sync:pokeapi
```

Useful modes:

```bash
npm run sync:pokeapi -- --dry-run
npm run sync:pokeapi -- --only species
npm run sync:pokeapi -- --only moves
npm run sync:pokeapi -- --no-cache
```

## Slug Policy

This project uses three different slug concepts.

### 1. Art slug

This is the slug derived from ANSI art filenames in `data/colorscripts/small/regular`.

Examples:

- `aegislash`
- `toxtricity`
- `urshifu`

Art slugs are the basis for:

- `art-species-split.json`
- `species-scaffold.json`
- encounter planning
- egg pool planning

### 2. Runtime species slug

This is the species identifier used in project runtime data such as:

- `species.json`
- `evolution.json`
- user-owned Pokemon records

In the current project direction, runtime species slugs follow the base-species workset and should stay aligned with art slugs unless there is a domain reason to split them later.

### 3. PokeAPI pokemon endpoint slug

This is the slug required by `GET /pokemon/{slug}`.

For a subset of species, PokeAPI requires a default form slug instead of the project base slug.

Examples:

- `aegislash` -> `aegislash-shield`
- `basculin` -> `basculin-red-striped`
- `deoxys` -> `deoxys-normal`
- `shaymin` -> `shaymin-land`
- `toxtricity` -> `toxtricity-amped`
- `urshifu` -> `urshifu-single-strike`

## Alias Rule

Slug mismatches are handled through:

- `data/pokemon/pokeapi-species-aliases.json`

This file maps:

- `project base species slug` -> `PokeAPI pokemon endpoint slug`

This mapping is used only for external fetches.

It must not be treated as a rename of the internal project species key.

## Why Aliases Are Preferred Over Renaming Art Files

The project intentionally keeps art slugs stable.

Reasons:

- art filenames are already the source for split/scaffold/audit documents
- runtime planning currently assumes the base species workset derived from those filenames
- PokeAPI endpoint names represent API-specific default forms, not necessarily the best internal canonical key
- renaming files would mix asset management concerns with external API compatibility concerns

Current decision:

- keep art filenames stable
- keep runtime base species slugs stable
- isolate PokeAPI-specific exceptions in the alias file

## Cache Policy

The sync pipeline stores raw remote responses under:

- `.cache/pokeapi/`

This directory is gitignored and exists only to make repeated sync runs faster and safer.

## Validation Status

After the full sync, the following checks passed:

- `npm.cmd run build`
- `npm.cmd -w packages/server test`

Current verified result:

- 22 test files passed
- 125 tests passed

## Deferred Work

The sync pipeline intentionally does not solve these areas yet:

- region encounter balancing
- egg gacha pool balancing
- advanced battle behavior using move `priority`, `meta`, and `statChanges`
- VariantData and permanent-variant runtime modeling
- battle-only systems such as Mega Evolution, Gigantamax, and Terastalization

Evolution runtime note:

- `location` conditions are now approximated through current region aliases
- `extra.min_affection` and `extra.min_beauty` are now approximated through friendship
- `extra.used_move` and `extra.min_move_count` are now supported through per-Pokemon move usage counters populated from battle actions
- `extra.min_damage_taken` is now supported through per-Pokemon cumulative damage tracked from battle actions
- `extra.turn_upside_down` is now supported through the curated `topsy-turvy` move substitute
- `extra.needs_overworld_rain` is now supported through the curated rain-region substitute
- trade-trigger branches are now supported through the dedicated player-to-player trade flow
- `extra.trade_species` is now supported inside that same trade flow
- there are currently `0` unsupported runtime evolution branches in the generated gap audit
- trade-trigger branches are still surfaced as deferred in Pokemon detail because they require another user
- Pokemon detail diagnostics now include progress-aware blocker text for tracked move-usage branches
- Pokemon detail diagnostics now also include progress-aware blocker text for tracked damage-threshold branches

Reference:

- [docs/pokemon-evolution-runtime-gaps.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-evolution-runtime-gaps.md:1)
- [docs/pokemon-trade-system.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-trade-system.md:1)

## Runtime Region Status

Runtime now persists a per-user `currentRegion` value and uses it for:

- reward-triggered encounter generation
- level-up evolution context
- status and region management routes

Current limitation:

- the repo now ships the following first-pass region pools:
  - `default`
  - `kanto`
  - `johto`
  - `hoenn`
  - `sinnoh`
  - `unova`
  - `kalos`
  - `alola`
  - `galar`
  - `hisui`

This means the region system is now structurally active with multiple curated encounter pools.
Most named regions now ship roughly 19-22 encounter entries with basic common/uncommon/rare layering.
The loader now normalizes region data so invalid species, non-positive weights, and broken level ranges do not silently pass through unchanged.
Balancing, rarity tuning, and long-tail species coverage are still early.

## Runtime Egg Gacha Status

The egg gacha is now global and intentionally ignores region state.

Current rules:

- only base-stage species are eligible
- `common` eggs cost `120P`, hatch level `1-6`, and bias toward easier-capture non-baby base species
- `rare` eggs cost `450P`, hatch level `5-12`, and bias toward baby species or harder-to-catch non-legendary base species
- `legend` eggs cost `3200P`, hatch level `15-25`, and only roll legendary or mythical base-stage species

This replaced the older sample hardcoded pools.
Current balancing is still heuristic, but the tier gap is now intentionally wide enough to make `legend` eggs a long-term point sink instead of a cheap shortcut.

## Runtime Variant Status

Runtime now has a dedicated variant table derived from the art split:

- `data/pokemon/variants.json`: 424 variants

The current variant layer separates:

- `regional`
- `permanent-form`
- `battle-form`

Current rules:

- battle forms are never encounter-eligible
- all variants are currently egg-ineligible
- owned Pokemon now reserve `variantId`, but no gameplay loop writes non-null variant ids yet
- override fields such as `typing` and `baseStatsOverride` are reserved for later curated fills

Reference:

- [docs/pokemon-variant-model.md](/C:/Users/dlwog/Desktop/project/pokelog/docs/pokemon-variant-model.md:1)

## Next Recommended Work

Trade UX note:

- trade target selection now supports partial id or nickname lookup
- trade request can now omit Pokemon uids and use candidate selection instead
- candidate lists include party and storage Pokemon, excluding any Pokemon currently active in battle
- users can now explicitly lock individual Pokemon out of trades
- locked Pokemon are hidden from candidate lists and also rejected by server-side trade validation
- the central trade store now keeps all pending trades but prunes resolved trades down to the latest 200 records

## Next Recommended Work

1. Decide whether one-off conditions like `turn_upside_down`, `needs_overworld_rain`, `min_damage_taken`, and `min_beauty` should get literal support or curated substitutes.
2. Populate runtime-significant variant overrides and decide which regional variants should become actual encounter targets.
3. Extend advanced battle behavior using move `priority`, `meta`, and `statChanges`.
4. Decide whether resolved trade records should also be archived before central-store pruning.
5. Decide whether trade eligibility should remain opt-out via lock, or move to explicit opt-in per Pokemon.
