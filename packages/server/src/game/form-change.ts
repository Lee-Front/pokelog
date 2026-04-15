import type { OwnedPokemon, UserData } from "../../../../shared/types.js";
import { projectPath } from "../paths.js";
import { readFileSync } from "node:fs";
import { getVariantsByBaseSpecies } from "./data-loader.js";
import { GameRuleError } from "./game-errors.js";
import { decrementItem } from "./inventory-utils.js";
import { findPokemonByUid } from "./pokemon-state.js";

export interface FormChangeRule {
  type: "catalog" | "toggle" | "held-item" | "nectar";
  forms: Record<string, { item: string | null }>;
  revertForm: string | null;
}

export { GameRuleError as FormChangeError };

let rulesCache: Record<string, FormChangeRule> | null = null;

/** Load form change rules from data file */
export function getFormChangeRules(): Record<string, FormChangeRule> {
  if (!rulesCache) {
    const raw = readFileSync(projectPath("data/pokemon/form-change-rules.json"), "utf-8");
    rulesCache = JSON.parse(raw) as Record<string, FormChangeRule>;
  }
  return rulesCache;
}

/** Clear cached rules (for testing) */
export function clearFormChangeRulesCache(): void {
  rulesCache = null;
}

/** Get the base species for a pokemon (strips variantId influence) */
function getBaseSpecies(pokemon: OwnedPokemon): string {
  return pokemon.species;
}

/** Check if a species has form change rules */
export function hasFormChangeRules(species: string): boolean {
  const rules = getFormChangeRules();
  return species in rules;
}

/** Get available forms for a pokemon species (variant IDs the species can change to) */
export function getAvailableForms(species: string): string[] {
  const rules = getFormChangeRules();
  const rule = rules[species];
  if (!rule) return [];
  return Object.keys(rule.forms);
}

/** Check if a pokemon can change to a given form */
export function canChangeForm(
  pokemon: OwnedPokemon,
  targetFormId: string | null,
): { ok: boolean; error?: string; rule?: FormChangeRule } {
  const species = getBaseSpecies(pokemon);
  const rules = getFormChangeRules();
  const rule = rules[species];

  if (!rule) {
    return { ok: false, error: `${species} cannot change forms.` };
  }

  // Reverting to base form is always allowed
  if (targetFormId === null || targetFormId === species) {
    return { ok: true, rule };
  }

  // Validate the target form exists in the rules
  if (!(targetFormId in rule.forms)) {
    return { ok: false, error: `${targetFormId} is not a valid form for ${species}.` };
  }

  // Also verify the variant exists in variants.json
  const variants = getVariantsByBaseSpecies(species);
  const variantExists = variants.some((v) => v.id === targetFormId);
  if (!variantExists) {
    return { ok: false, error: `Variant ${targetFormId} not found in variant data.` };
  }

  return { ok: true, rule };
}

/** Resolve a form change — returns the new variantId and optional item to consume */
export function resolveFormChange(
  pokemon: OwnedPokemon,
  targetFormId: string | null,
): { variantId: string | null; consumeItem?: string } {
  const species = getBaseSpecies(pokemon);
  const rules = getFormChangeRules();
  const rule = rules[species];

  if (!rule) {
    throw new GameRuleError(`${species} cannot change forms.`);
  }

  // Reverting to base form
  if (targetFormId === null || targetFormId === species) {
    return { variantId: null };
  }

  const formEntry = rule.forms[targetFormId];
  if (!formEntry) {
    throw new GameRuleError(`${targetFormId} is not a valid form for ${species}.`);
  }

  const result: { variantId: string | null; consumeItem?: string } = {
    variantId: targetFormId,
  };

  // For nectar type, the item is consumed
  if (rule.type === "nectar" && formEntry.item) {
    result.consumeItem = formEntry.item;
  }

  // For toggle type, item is not consumed (it's a reusable key item)
  // For catalog type, no item needed
  // For held-item type, item is equipped as heldItem (handled in applyFormChange)

  return result;
}

/** Apply a form change to a pokemon, mutating user data as needed.
 *  Returns the updated pokemon. */
export function applyFormChange(
  user: UserData,
  pokemonUid: string,
  targetFormId: string | null,
): { pokemon: OwnedPokemon; previousVariantId: string | null } {
  const pokemon = findPokemonByUid(user, pokemonUid);

  if (!pokemon) {
    throw new GameRuleError("Pokemon not found.", 404);
  }

  const species = getBaseSpecies(pokemon);
  const rules = getFormChangeRules();
  const rule = rules[species];

  if (!rule) {
    throw new GameRuleError(`${species} cannot change forms.`);
  }

  const previousVariantId = pokemon.variantId ?? null;

  // Reverting to base form
  if (targetFormId === null || targetFormId === species) {
    // For held-item types, unequip the held item and return it to inventory
    if (rule.type === "held-item" && pokemon.heldItem) {
      // Check if the current held item is a form-changing item for this species
      const currentFormItem = previousVariantId ? rule.forms[previousVariantId]?.item : null;
      if (currentFormItem && pokemon.heldItem === currentFormItem) {
        user.inventory[pokemon.heldItem] = (user.inventory[pokemon.heldItem] ?? 0) + 1;
        pokemon.heldItem = null;
      }
    }
    pokemon.variantId = null;
    return { pokemon, previousVariantId };
  }

  const formEntry = rule.forms[targetFormId];
  if (!formEntry) {
    throw new GameRuleError(`${targetFormId} is not a valid form for ${species}.`);
  }

  // Handle item logic based on rule type
  if (rule.type === "held-item") {
    const requiredItem = formEntry.item;
    if (!requiredItem) {
      throw new GameRuleError(`No item defined for form ${targetFormId}.`);
    }

    // Check inventory for the item
    if (!user.inventory[requiredItem] || user.inventory[requiredItem] <= 0) {
      throw new GameRuleError(`You need a ${requiredItem} to change to this form.`);
    }

    // If pokemon is already holding a form item, return it to inventory
    if (pokemon.heldItem) {
      user.inventory[pokemon.heldItem] = (user.inventory[pokemon.heldItem] ?? 0) + 1;
    }

    // Consume from inventory and equip as held item
    decrementItem(user.inventory, requiredItem);
    pokemon.heldItem = requiredItem;
  }

  if (rule.type === "nectar") {
    const requiredItem = formEntry.item;
    if (requiredItem) {
      if (!user.inventory[requiredItem] || user.inventory[requiredItem] <= 0) {
        throw new GameRuleError(`You need a ${requiredItem} to change to this form.`);
      }
      decrementItem(user.inventory, requiredItem);
    }
  }

  if (rule.type === "toggle") {
    // Toggle items are reusable key items — check inventory but don't consume
    const requiredItem = formEntry.item;
    if (requiredItem) {
      if (!user.inventory[requiredItem] || user.inventory[requiredItem] <= 0) {
        throw new GameRuleError(`You need a ${requiredItem} to change to this form.`);
      }
      // Don't consume — toggle items are reusable
    }
  }

  // catalog type: no item needed

  pokemon.variantId = targetFormId;
  return { pokemon, previousVariantId };
}
