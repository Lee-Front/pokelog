# Pokemon Art Split

Generated: 2026-04-14T01:00:57.560Z

## Summary

- Raw regular art slugs: 1329
- Base species candidates: 905
- Special forms: 424
- Current `species.json` coverage for base species: 874/905 (96.57%)
- Current `species.json` entries that are already special forms: 0
- Unclassified special slugs: 0

## Why This Split Exists

- Raw art slugs include many forms that should not be treated as separate encounter species by default.
- This split keeps canonical species such as `mr-mime`, `ho-oh`, `jangmo-o`, and `wo-chien` in the base list.
- Forms such as megas, regional variants, gigantamax, battle forms, and cosmetic variants are moved into a separate list.

## Special Form Categories

- alcremie-form: 72
- regional: 53
- mega: 48
- type-form: 35
- pattern-form: 33
- gigantamax: 32
- unown-form: 27
- event-form: 24
- color-form: 21
- battle-form: 15
- trim-form: 9
- cap-form: 8
- costume-form: 8
- regional-special: 6
- seasonal-form: 6
- rotom-appliance: 5
- cloak-form: 4
- gene-drive: 4
- therian: 4
- origin: 3
- size-form: 3
- primal: 2
- rider: 2

## Base Species Missing Data Preview

- `aegislash`
- `basculegion`
- `basculin`
- `darmanitan`
- `deoxys`
- `eiscue`
- `enamorus`
- `frillish`
- `giratina`
- `gourgeist`
- `indeedee`
- `jellicent`
- `keldeo`
- `landorus`
- `lycanroc`
- `meloetta`
- `meowstic`
- `mimikyu`
- `minior`
- `morpeko`
- `oricorio`
- `pumpkaboo`
- `pyroar`
- `shaymin`
- `thundurus`
- `tornadus`
- `toxtricity`
- `urshifu`
- `wishiwashi`
- `wormadam`
- `zygarde`

## Special Form Preview

- `abomasnow-mega` -> `abomasnow` (mega)
- `absol-mega` -> `absol` (mega)
- `aegislash-blade` -> `aegislash` (battle-form)
- `aerodactyl-mega` -> `aerodactyl` (mega)
- `aggron-mega` -> `aggron` (mega)
- `alakazam-mega` -> `alakazam` (mega)
- `alcremie-caramel-swirl-berry` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-clover` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-flower` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-love` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-plain` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-ribbon` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-star` -> `alcremie` (alcremie-form)
- `alcremie-caramel-swirl-strawberry` -> `alcremie` (alcremie-form)
- `alcremie-gmax` -> `alcremie` (gigantamax)
- `alcremie-lemon-cream-berry` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-clover` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-flower` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-love` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-plain` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-ribbon` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-star` -> `alcremie` (alcremie-form)
- `alcremie-lemon-cream-strawberry` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-berry` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-clover` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-flower` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-love` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-plain` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-ribbon` -> `alcremie` (alcremie-form)
- `alcremie-matcha-cream-star` -> `alcremie` (alcremie-form)

## Recommended Usage

1. Use `baseSpeciesSlugs` as the default source for encounter pools, egg pools, and first-pass species data entry.
2. Keep `specialForms` out of normal region and egg rolls until form systems exist.
3. Add special forms later through explicit mechanics such as regional pools, battle transformations, or cosmetic unlocks.

