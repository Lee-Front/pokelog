# Pokemon Data Audit

Generated: 2026-04-12T06:43:01.715Z

## Summary

- Regular ANSI art slugs: 1329
- Shiny ANSI art slugs: 1329
- Species entries in `data/pokemon/species.json`: 20
- Move entries in `data/moves/moves.json`: 20
- Evolution entries in `data/pokemon/evolution.json`: 14
- Regular art coverage by species data: 20/1329 (1.50%)

## Current Gaps

- Regular art slugs missing from species data: 1309
- Species entries without matching regular art: 0
- Species entries without an evolution entry: 6
- Learnset move ids missing from move data: 0
- Evolution sources missing from species data: 0
- Evolution targets missing from species data: 0

## Notes

- The art inventory is based on raw slug filenames in `data/colorscripts/small/regular`.
- Raw art slugs include alternate forms, megas, regional variants, gmax forms, and other special cases.
- The current species schema is still a starter dataset, so the art count is a better proxy for total scope than the current `species.json`.

## Missing Species Data Preview

- `abomasnow`
- `abomasnow-mega`
- `abra`
- `absol`
- `absol-mega`
- `accelgor`
- `aegislash`
- `aegislash-blade`
- `aerodactyl`
- `aerodactyl-mega`
- `aggron`
- `aggron-mega`
- `aipom`
- `alakazam`
- `alakazam-mega`
- `alcremie`
- `alcremie-caramel-swirl-berry`
- `alcremie-caramel-swirl-clover`
- `alcremie-caramel-swirl-flower`
- `alcremie-caramel-swirl-love`
- `alcremie-caramel-swirl-plain`
- `alcremie-caramel-swirl-ribbon`
- `alcremie-caramel-swirl-star`
- `alcremie-caramel-swirl-strawberry`
- `alcremie-gmax`
- `alcremie-lemon-cream-berry`
- `alcremie-lemon-cream-clover`
- `alcremie-lemon-cream-flower`
- `alcremie-lemon-cream-love`
- `alcremie-lemon-cream-plain`
- `alcremie-lemon-cream-ribbon`
- `alcremie-lemon-cream-star`
- `alcremie-lemon-cream-strawberry`
- `alcremie-matcha-cream-berry`
- `alcremie-matcha-cream-clover`
- `alcremie-matcha-cream-flower`
- `alcremie-matcha-cream-love`
- `alcremie-matcha-cream-plain`
- `alcremie-matcha-cream-ribbon`
- `alcremie-matcha-cream-star`
- ... and 1269 more

## Species Missing Evolution Entry Preview

- `blastoise`
- `charizard`
- `pidgeotto`
- `raichu`
- `raticate`
- `venusaur`

## Missing Learnset Move Data Preview

- none

## Recommended Next Steps

1. Expand `species.json` to cover every regular art slug that should be encounterable.
2. Split raw slug coverage into base species versus special forms so region pools and egg pools can be balanced cleanly.
3. Expand `EvolutionData` beyond single-target level evolutions to support item, branch, trade, friendship, move-known, and regional conditions.
4. Expand `MoveData` and battle logic to support status moves and move effects, not just power-based damage.
5. Replace hard-coded egg pools with a data-driven pool that references audited species coverage.

