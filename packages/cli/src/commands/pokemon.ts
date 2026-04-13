import { BLD, DIM, GRN, R, YEL } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchArt, renderHpBar, sideBySide } from "../ui/display.js";
import { selectAction } from "../ui/prompts.js";
import { getPendingEvolutions, resolvePendingEvolutionForPokemon } from "./evolutions.js";

type PokemonDetail = {
  uid: string;
  species: string;
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
  tradeLocked?: boolean;
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
      `${DIM}Trade${R} ${pokemon.tradeLocked ? `${YEL}LOCKED${R}` : `${GRN}OPEN${R}`}`,
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

    console.log();
    const action = await selectAction("", [
      ...(hasPendingEvolution
        ? [{ name: "Resolve pending evolution", value: "evolve" as const }]
        : []),
      {
        name: pokemon.tradeLocked ? "Unlock trade" : "Lock trade",
        value: pokemon.tradeLocked ? "unlock-trade" as const : "lock-trade" as const,
      },
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

    if (action === "lock-trade" || action === "unlock-trade") {
      const response = await apiPost(
        action === "lock-trade" ? "/api/game/trades/lock" : "/api/game/trades/unlock",
        { pokemonUid: uid },
      );

      if (!response.ok) {
        console.error(`Error: ${String(response.data.error ?? "Failed to update trade lock.")}`);
        return;
      }
    }
  }
}
