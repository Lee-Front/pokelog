# Pokemon Data Audit

Generated: 2026-04-14T01:01:04.927Z

## Summary

- Regular ANSI art slugs: 1329
- Shiny ANSI art slugs: 1329
- Species entries in `data/pokemon/species.json`: 905
- Move entries in `data/moves/moves.json`: 937
- Evolution entries in `data/pokemon/evolution.json`: 905
- Regular art coverage by species data: 874/1329 (65.76%)

## Current Gaps

- Regular art slugs missing from species data: 455
- Species entries without matching regular art: 31
- Species entries without an evolution entry: 31
- Learnset move ids missing from move data: 0
- Evolution sources missing from species data: 31
- Evolution targets missing from species data: 18

## Notes

- The art inventory is based on raw slug filenames in `data/colorscripts/small/regular`.
- Raw art slugs include alternate forms, megas, regional variants, gmax forms, and other special cases.
- The current species schema is still a starter dataset, so the art count is a better proxy for total scope than the current `species.json`.

## Missing Species Data Preview

- `abomasnow-mega`
- `absol-mega`
- `aegislash`
- `aegislash-blade`
- `aerodactyl-mega`
- `aggron-mega`
- `alakazam-mega`
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
- `alcremie-matcha-cream-strawberry`
- `alcremie-mint-cream-berry`
- `alcremie-mint-cream-clover`
- `alcremie-mint-cream-flower`
- `alcremie-mint-cream-love`
- `alcremie-mint-cream-plain`
- `alcremie-mint-cream-ribbon`
- `alcremie-mint-cream-star`
- `alcremie-mint-cream-strawberry`
- ... and 415 more

## Species Missing Evolution Entry Preview

- `aegislash-shield`
- `basculegion-male`
- `basculin-red-striped`
- `darmanitan-standard`
- `deoxys-normal`
- `eiscue-ice`
- `enamorus-incarnate`
- `frillish-male`
- `giratina-altered`
- `gourgeist-average`
- `indeedee-male`
- `jellicent-male`
- `keldeo-ordinary`
- `landorus-incarnate`
- `lycanroc-midday`
- `meloetta-aria`
- `meowstic-male`
- `mimikyu-disguised`
- `minior-red-meteor`
- `morpeko-full-belly`
- ... and 11 more

## Missing Learnset Move Data Preview

- none

## Recommended Next Steps

1. Expand `species.json` to cover every regular art slug that should be encounterable.
2. Split raw slug coverage into base species versus special forms so region pools and egg pools can be balanced cleanly.
3. Expand `EvolutionData` beyond single-target level evolutions to support item, branch, trade, friendship, move-known, and regional conditions.
4. Expand `MoveData` and battle logic to support status moves and move effects, not just power-based damage.
5. Replace hard-coded egg pools with a data-driven pool that references audited species coverage.

