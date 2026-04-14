/**
 * Pokemon detail 순수 로직 — I/O 없음, 테스트 가능
 */

export interface PokemonSummary {
  species: string;
  nickname: string | null;
  level: number;
  hp: number;
  maxHp: number;
  heldItem: string | null;
  nature: string | null;
  gender: string | null;
  isShiny: boolean;
}

export interface EquipAction {
  type: "equip" | "unequip" | "evolve" | "back";
}

export function buildPokemonActions(
  pokemon: PokemonSummary,
  hasPendingEvolution: boolean,
  hasFormChange = false,
): Array<{ name: string; value: string }> {
  const actions: Array<{ name: string; value: string }> = [];

  if (hasPendingEvolution) {
    actions.push({ name: "Resolve pending evolution", value: "evolve" });
  }

  if (hasFormChange) {
    actions.push({ name: "Form Change", value: "form-change" });
  }

  if (pokemon.heldItem) {
    actions.push({ name: `Unequip ${pokemon.heldItem}`, value: "unequip" });
  } else {
    actions.push({ name: "Equip held item", value: "equip" });
  }

  actions.push({ name: "Back", value: "back" });
  return actions;
}

export function filterHoldableItems(
  inventory: Record<string, number>,
  catalog: Record<string, { kind?: string }>,
): string[] {
  return Object.entries(inventory)
    .filter(([id, qty]) => qty > 0 && catalog[id]?.kind === "held")
    .map(([id]) => id);
}

export function formatPokemonInfoLine(pokemon: PokemonSummary): string {
  const parts: string[] = [];
  if (pokemon.nature) parts.push(`Nature: ${pokemon.nature}`);
  if (pokemon.gender) parts.push(`Gender: ${pokemon.gender}`);
  if (pokemon.isShiny) parts.push("★ Shiny");
  return parts.join("  ");
}
