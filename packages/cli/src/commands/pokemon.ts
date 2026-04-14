import { BLD, DIM, GRN, R, YEL } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchArt, renderHpBar, sideBySide } from "../ui/display.js";
import { selectAction } from "../ui/prompts.js";
import { getPendingEvolutions, resolvePendingEvolutionForPokemon } from "./evolutions.js";
import { getFormChangeActions } from "../logic/form-change.js";

type PokemonDetail = {
  uid: string;
  species: string;
  variantId?: string | null;
  nickname: string | null;
  level: number;
  exp: number;
  hp: number;
  maxHp: number;
  stats: {
    attack: number;
    defense: number;
    speed: number;
    spAttack: number;
    spDefense: number;
  };
  moves: Array<{ id: string; pp: number; maxPp: number }>;
  caughtAt: string;
  heldItem?: string | null;
  nature?: string;
  isShiny?: boolean;
  gender?: string;
};

type EvolutionPreviewEntry = {
  branchId: string;
  targetSpecies: string;
  targetName: string;
  trigger: string;
  status: "available" | "blocked" | "unsupported";
  requirements: string[];
  blockers: string[];
};

export async function pokemonCommand(uid: string) {
  while (true) {
    const [pokemonResponse, pendingEntries] = await Promise.all([
      apiGet(`/api/game/pokemon/${uid}`),
      getPendingEvolutions(),
    ]);

    if (!pokemonResponse.ok) {
      console.error(`Error: ${String(pokemonResponse.data.error ?? "Failed to load Pokemon.")}`);
      return;
    }

    const pokemon = pokemonResponse.data.pokemon as PokemonDetail;
    const evolutionPreview = (pokemonResponse.data.evolutionPreview ?? []) as EvolutionPreviewEntry[];
    const hasPendingEvolution = pendingEntries.some((entry) => entry.pokemonUid === uid);

    process.stdout.write("\x1b[2J\x1b[H");
    const art = await fetchArt(pokemon.species);

    const name = pokemon.nickname ? `${pokemon.nickname} ${DIM}(${pokemon.species})${R}` : pokemon.species;
    const hpColor = pokemon.hp / pokemon.maxHp <= 0.25 ? "\x1b[31m" : pokemon.hp / pokemon.maxHp <= 0.5 ? YEL : GRN;

    const statsLines: string[] = [
      "",
      `${BLD}${name}${R}  ${DIM}Lv.${pokemon.level}${R}`,
      `${DIM}HP${R}  ${hpColor}${renderHpBar(pokemon.hp, pokemon.maxHp, 14)}${R}`,
      `${DIM}EXP${R} ${pokemon.exp}`,
      `${DIM}Nature${R} ${pokemon.nature ?? "???"}  ${DIM}Gender${R} ${pokemon.gender ?? "?"}${pokemon.isShiny ? `  ${YEL}★${R}` : ""}`,
      `${DIM}Item${R}   ${pokemon.heldItem ? pokemon.heldItem : `${DIM}none${R}`}`,
      hasPendingEvolution ? `${YEL}Pending Evolution Ready${R}` : "",
      "",
      `${DIM}${"-".repeat(24)}${R}`,
      `${DIM}Attack${R}     ${String(pokemon.stats.attack).padEnd(5)}${DIM}Defense${R}    ${pokemon.stats.defense}`,
      `${DIM}Sp. Atk${R}    ${String(pokemon.stats.spAttack).padEnd(5)}${DIM}Sp. Def${R}    ${pokemon.stats.spDefense}`,
      `${DIM}Speed${R}      ${pokemon.stats.speed}`,
      "",
      `${DIM}${"-".repeat(24)}${R}`,
      `${DIM}Moves${R}`,
      ...pokemon.moves.map((move) => {
        const ppColor = move.pp === 0 ? "\x1b[31m" : move.pp <= move.maxPp * 0.25 ? YEL : DIM;
        return `  ${move.id.padEnd(16)}${ppColor}PP ${move.pp}/${move.maxPp}${R}`;
      }),
      ...(evolutionPreview.length > 0
        ? [
            "",
            `${DIM}${"-".repeat(24)}${R}`,
            `${DIM}Evolution${R}`,
            ...evolutionPreview.flatMap((branch) => {
              const statusLabel = branch.status === "available"
                ? `${GRN}READY${R}`
                : branch.status === "unsupported"
                  ? `${YEL}DEFERRED${R}`
                  : `${DIM}BLOCKED${R}`;

              return [
                `  ${branch.targetName.padEnd(16)}${statusLabel}`,
                ...(branch.blockers.slice(0, 2).map((reason) => `    ${DIM}- ${reason}${R}`)),
              ];
            }),
          ]
        : []),
    ].filter(Boolean);

    const statsStr = statsLines.join("\n");

    if (art) {
      console.log();
      console.log(sideBySide(art, statsStr, 4));
    } else {
      console.log(statsStr);
    }

    // Check form change availability
    const formRulesRes = await apiGet(`/api/game/form-change/rules/${pokemon.species}`);
    const formChangeForms: string[] = formRulesRes.ok ? (formRulesRes.data.forms as string[]) : [];
    const formChangeActions = getFormChangeActions(formChangeForms, pokemon.variantId);
    const hasFormChange = formChangeActions.length > 0;

    console.log();
    const action = await selectAction("", [
      ...(hasPendingEvolution
        ? [{ name: "Resolve pending evolution", value: "evolve" as const }]
        : []),
      ...(hasFormChange
        ? [{ name: "Form Change", value: "form-change" as const }]
        : []),
      ...(pokemon.heldItem
        ? [{ name: `Unequip ${pokemon.heldItem}`, value: "unequip" as const }]
        : [{ name: "Equip held item", value: "equip" as const }]),
      { name: "Back", value: "back" as const },
    ]);

    if (action === "back") {
      return;
    }

    if (action === "evolve") {
      const result = await resolvePendingEvolutionForPokemon(uid);
      if (result !== "resolved") {
        return;
      }
    }

    if (action === "form-change") {
      const formChoice = await selectAction("Select form", [
        ...formChangeActions.map((a) => ({ name: a.name, value: a.value })),
        { name: "Cancel", value: "cancel" },
      ]);
      if (formChoice === "cancel") continue;

      const targetFormId = formChoice === "__revert__" ? null : formChoice;
      const formRes = await apiPost("/api/game/form-change", {
        pokemonUid: uid,
        targetFormId,
      });
      if (!formRes.ok) {
        console.error(`Error: ${String(formRes.data.error)}`);
      }
      continue;
    }

    if (action === "equip") {
      const invResponse = await apiGet("/api/game/inventory");
      if (!invResponse.ok) continue;
      const inventory = invResponse.data.inventory as Record<string, number>;
      const catalog = (invResponse.data.catalog ?? {}) as Record<string, { kind?: string }>;
      const holdableItems = Object.entries(inventory)
        .filter(([id, qty]) => qty > 0 && catalog[id]?.kind === "held")
        .map(([id]) => ({ name: id, value: id }));

      if (holdableItems.length === 0) {
        console.log(`${DIM}장착 가능한 아이템이 없습니다${R}`);
        continue;
      }

      const item = await selectAction("장착할 아이템", [
        ...holdableItems,
        { name: "취소", value: "back" },
      ]);
      if (item === "back") continue;

      const equipRes = await apiPost("/api/game/items/equip", { item, pokemonUid: uid });
      if (!equipRes.ok) {
        console.error(`Error: ${String(equipRes.data.error)}`);
      }
      continue;
    }

    if (action === "unequip") {
      const unequipRes = await apiPost("/api/game/items/unequip", { pokemonUid: uid });
      if (!unequipRes.ok) {
        console.error(`Error: ${String(unequipRes.data.error)}`);
      }
      continue;
    }

  }
}
