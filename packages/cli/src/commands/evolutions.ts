import { apiGet, apiPost } from "../api-client.js";
import { separator } from "../ui/prompts.js";
import { formatScreenMessage, runMenuLoop, selectFrame, type ScreenMessage } from "../ui/screen.js";

export type PendingEvolutionOption = {
  branchId: string;
  targetSpecies: string;
  targetName: string;
};

export type PendingEvolutionEntry = {
  id: string;
  pokemonUid: string;
  sourceSpecies: string;
  sourceName: string;
  options: PendingEvolutionOption[];
  pokemon?: {
    level: number;
    nickname?: string | null;
  } | null;
};

function getPokemonLabel(entry: PendingEvolutionEntry): string {
  const nickname = entry.pokemon?.nickname?.trim();
  const level = entry.pokemon?.level != null ? `Lv.${entry.pokemon.level}` : "";
  const source = nickname ? `${nickname} (${entry.sourceName})` : entry.sourceName;
  return [source, level].filter(Boolean).join(" ");
}

export async function getPendingEvolutions(): Promise<PendingEvolutionEntry[]> {
  const response = await apiGet("/api/game/evolutions/pending");
  if (!response.ok) {
    console.error(`Error: ${response.data.error}`);
    return [];
  }

  return (response.data.pending ?? []) as PendingEvolutionEntry[];
}

async function choosePendingEvolutionEntry(entries: PendingEvolutionEntry[]): Promise<PendingEvolutionEntry | null> {
  const pendingId = await selectFrame(
    "Choose a Pokemon to evolve",
    [
      ...entries.map((entry) => ({
        name: `${getPokemonLabel(entry)} (${entry.options.length} options)`,
        value: entry.id,
      })),
      separator(" "),
      { name: "Cancel", value: "__cancel__" },
    ],
  );

  if (!pendingId || pendingId === "__cancel__") {
    return null;
  }

  return entries.find((entry) => entry.id === pendingId) ?? null;
}

async function resolvePendingEvolutionEntry(selected: PendingEvolutionEntry): Promise<"resolved" | "cancelled" | "error"> {
  const branchId = await selectFrame(
    `Choose an evolution for ${getPokemonLabel(selected)}`,
    [
      ...selected.options.map((option) => ({
        name: `${selected.sourceName} -> ${option.targetName}`,
        value: option.branchId,
      })),
      separator(" "),
      { name: "Cancel", value: "__cancel__" },
    ],
  );

  if (!branchId || branchId === "__cancel__") {
    return "cancelled";
  }

  const resolveResponse = await apiPost("/api/game/evolutions/resolve", {
    pendingEvolutionId: selected.id,
    branchId,
  });

  if (!resolveResponse.ok) {
    console.error(`Error: ${resolveResponse.data.error}`);
    return "error";
  }

  console.log(resolveResponse.data.message ?? "Evolution completed.");
  return "resolved";
}

export async function resolvePendingEvolutionForPokemon(
  pokemonUid: string,
): Promise<"resolved" | "cancelled" | "not-found" | "error"> {
  const pending = await getPendingEvolutions();
  if (pending.length === 0) {
    return "not-found";
  }

  const selected = pending.find((entry) => entry.pokemonUid === pokemonUid);
  if (!selected) {
    return "not-found";
  }

  return resolvePendingEvolutionEntry(selected);
}

export async function evolutionsCommand() {
  type EvolutionScreenState = { message: ScreenMessage | null };

  await runMenuLoop<EvolutionScreenState, PendingEvolutionEntry[], string>({
    initialState: { message: null },
    load: async () => getPendingEvolutions(),
    prompt: () => "Pending evolutions",
    items: (pending, state) => {
      const items: Array<{ name: string; value: string } | { separator: string }> = [];

      if (pending.length === 0) {
        items.push(separator("  No pending evolutions."));
      } else {
        for (const entry of pending) {
          items.push({
            name: `${getPokemonLabel(entry)} (${entry.options.length} options)`,
            value: entry.id,
          });
        }
      }

      if (state.message) {
        items.push(separator(" "));
        items.push(separator(`  ${formatScreenMessage(state.message)}`));
      }

      items.push(separator(" "));
      items.push({ name: "Close", value: "__close__" });
      return items;
    },
    onSelect: async (selected, pending, state) => {
      if (selected === "__close__") {
        return { state, close: true };
      }

      const entry = pending.find((candidate) => candidate.id === selected);
      if (!entry) {
        return state;
      }

      const result = await resolvePendingEvolutionEntry(entry);
      if (result === "resolved") {
        return { message: { tone: "success", text: "Evolution completed." } };
      }
      if (result === "error") {
        return { message: { tone: "error", text: "Failed to resolve evolution." } };
      }
      return state;
    },
  });
}
