import { BLD, CYN, DIM, GRN, R, RED, YEL } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchArt } from "../ui/display.js";
import { redraw } from "../ui/screen.js";
import { artToLines, padRight } from "../ui/text.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { getPendingEvolutions, resolvePendingEvolutionForPokemon } from "./evolutions.js";

type PokemonEntry = {
  uid: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
};

type StorageData = {
  party: PokemonEntry[];
  storage: PokemonEntry[];
};

const PARTY_W = 26;
const STORAGE_W = 26;
const GAP = "   ";
const STORAGE_VISIBLE = 6;

const artCache = new Map<string, string | null>();

async function fetchData(): Promise<StorageData | null> {
  const [partyResponse, storageResponse] = await Promise.all([
    apiGet("/api/game/party"),
    apiGet("/api/game/storage"),
  ]);

  if (!partyResponse.ok || !storageResponse.ok) {
    return null;
  }

  return {
    party: partyResponse.data.party as PokemonEntry[],
    storage: storageResponse.data.storage as PokemonEntry[],
  };
}

async function getCachedArt(species: string): Promise<string | null> {
  if (artCache.has(species)) {
    return artCache.get(species)!;
  }

  const art = await fetchArt(species);
  artCache.set(species, art);
  return art;
}

function getSelectedPokemon(
  party: PokemonEntry[],
  storage: PokemonEntry[],
  panel: "party" | "storage",
  partyIndex: number,
  storageIndex: number,
): PokemonEntry | null {
  return panel === "party"
    ? (party[partyIndex] ?? null)
    : (storage[storageIndex] ?? null);
}

function buildPartyLines(
  party: PokemonEntry[],
  panel: "party" | "storage",
  partyIndex: number,
  pendingEvolutionUids: Set<string>,
): string[] {
  const lines = [
    panel === "party"
      ? `${CYN}${BLD}Party (${party.length}/6)${R}`
      : `${YEL}Party (${party.length}/6)${R}`,
  ];

  for (let i = 0; i < 6; i += 1) {
    const pokemon = party[i];
    const active = panel === "party" && i === partyIndex;
    const pointer = active ? `${CYN}>${R}` : " ";

    if (!pokemon) {
      lines.push(`${pointer} ${DIM}(empty)${R}`);
      continue;
    }

    const name = active ? `${BLD}${pokemon.species}${R}` : pokemon.species;
    const evoBadge = pendingEvolutionUids.has(pokemon.uid) ? ` ${YEL}EVO${R}` : "";
    lines.push(`${pointer} ${padRight(name, 14)} ${DIM}Lv.${pokemon.level}${R}${evoBadge}`);
  }

  return lines;
}

function buildStorageLines(
  storage: PokemonEntry[],
  panel: "party" | "storage",
  storageIndex: number,
  storageScroll: number,
  pendingEvolutionUids: Set<string>,
): string[] {
  const end = Math.min(storageScroll + STORAGE_VISIBLE, storage.length);
  const headerLabel = storage.length === 0
    ? "Storage (empty)"
    : storage.length <= STORAGE_VISIBLE
      ? `Storage (${storage.length})`
      : `Storage ${storageScroll + 1}-${end}/${storage.length}`;

  const lines = [
    panel === "storage"
      ? `${CYN}${BLD}${headerLabel}${R}`
      : `${DIM}${headerLabel}${R}`,
  ];

  if (storage.length === 0) {
    for (let i = 0; i < STORAGE_VISIBLE; i += 1) {
      lines.push(i === 0 ? `  ${DIM}No Pokemon in storage.${R}` : "");
    }
    return lines;
  }

  for (let i = 0; i < STORAGE_VISIBLE; i += 1) {
    const absoluteIndex = storageScroll + i;
    if (absoluteIndex >= storage.length) {
      lines.push("");
      continue;
    }

    const pokemon = storage[absoluteIndex];
    const active = panel === "storage" && absoluteIndex === storageIndex;
    const pointer = active ? `${CYN}>${R}` : " ";
    const name = active ? `${BLD}${pokemon.species}${R}` : pokemon.species;
    const evoBadge = pendingEvolutionUids.has(pokemon.uid) ? ` ${YEL}EVO${R}` : "";
    lines.push(`${pointer} ${padRight(name, 14)} ${DIM}Lv.${pokemon.level}${R}${evoBadge}`);
  }

  return lines;
}

function buildLines(
  party: PokemonEntry[],
  storage: PokemonEntry[],
  panel: "party" | "storage",
  partyIndex: number,
  storageIndex: number,
  storageScroll: number,
  art: string | null,
  message: string,
  pendingEvolutionUids: Set<string>,
): string[] {
  const partyLines = buildPartyLines(party, panel, partyIndex, pendingEvolutionUids);
  const storageLines = buildStorageLines(storage, panel, storageIndex, storageScroll, pendingEvolutionUids);
  const artLines = artToLines(art);
  const rows = Math.max(partyLines.length, storageLines.length, artLines.length);
  const merged: string[] = [];

  for (let i = 0; i < rows; i += 1) {
    const left = padRight(partyLines[i] ?? "", PARTY_W);
    const middle = padRight(storageLines[i] ?? "", STORAGE_W);
    const right = artLines[i] ?? "";
    merged.push(`  ${left}${GAP}${middle}${GAP}${right}`);
  }

  const lines = [
    "",
    `  ${BLD}Pokemon Storage${R}`,
    "  " + "-".repeat(62),
    `  ${DIM}Left/Right: Panel  Up/Down: Move  Enter: Transfer  E: Resolve evolution  Esc: Back${R}`,
    "",
    ...merged,
    "",
  ];

  if (message) {
    lines.push(`  ${message}`);
  }

  return lines;
}

export async function storageCommand() {
  enterRaw();

  let data = await fetchData();
  if (!data) {
    process.stdout.write("  Failed to load storage data.\n");
    return;
  }

  let pendingEvolutionUids = new Set<string>();
  let panel: "party" | "storage" = "party";
  let partyIndex = 0;
  let storageIndex = 0;
  let storageScroll = 0;
  let currentArt: string | null = null;
  let lastSpecies = "";
  let message = "";
  let lineCount = 0;
  let first = true;

  async function refreshAll() {
    const [freshData, pending] = await Promise.all([fetchData(), getPendingEvolutions()]);
    if (freshData) {
      data = freshData;
    }
    pendingEvolutionUids = new Set(pending.map((entry) => entry.pokemonUid));
  }

  await refreshAll();

  while (true) {
    const { party, storage } = data;
    partyIndex = Math.min(partyIndex, Math.max(0, party.length - 1));
    storageIndex = Math.min(storageIndex, Math.max(0, storage.length - 1));
    storageScroll = Math.max(0, Math.min(storageScroll, Math.max(0, storage.length - STORAGE_VISIBLE)));

    const selectedPokemon = getSelectedPokemon(party, storage, panel, partyIndex, storageIndex);
    const species = selectedPokemon?.species ?? "";

    if (species !== lastSpecies) {
      currentArt = species ? await getCachedArt(species) : null;
      lastSpecies = species;
    }

    lineCount = redraw(
      buildLines(
        party,
        storage,
        panel,
        partyIndex,
        storageIndex,
        storageScroll,
        currentArt,
        message,
        pendingEvolutionUids,
      ),
      lineCount, first,
    );
    first = false;
    message = "";

    const key = await waitKey();
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b" || key === "q") {
      break;
    }

    if (key === "\x1b[A") {
      if (panel === "party" && partyIndex > 0) {
        partyIndex -= 1;
      } else if (panel === "storage" && storageIndex > 0) {
        storageIndex -= 1;
        if (storageIndex < storageScroll) {
          storageScroll = storageIndex;
        }
      }
      continue;
    }

    if (key === "\x1b[B") {
      if (panel === "party" && partyIndex < party.length - 1) {
        partyIndex += 1;
      } else if (panel === "storage" && storageIndex < storage.length - 1) {
        storageIndex += 1;
        if (storageIndex >= storageScroll + STORAGE_VISIBLE) {
          storageScroll = storageIndex - STORAGE_VISIBLE + 1;
        }
      }
      continue;
    }

    if (key === "\x1b[D") {
      if (panel === "storage") {
        panel = "party";
      }
      continue;
    }

    if (key === "\x1b[C") {
      if (panel === "party" && storage.length > 0) {
        panel = "storage";
      }
      continue;
    }

    if (key === "e" || key === "E") {
      const pokemon = selectedPokemon;
      if (!pokemon || !pendingEvolutionUids.has(pokemon.uid)) {
        message = `${DIM}No pending evolution for the selected Pokemon.${R}`;
        continue;
      }

      process.stdout.write("\x1b[?25h");
      const result = await resolvePendingEvolutionForPokemon(pokemon.uid);
      if (result === "resolved") {
        message = `${GRN}Pending evolution resolved.${R}`;
      } else if (result === "cancelled") {
        message = `${DIM}Evolution cancelled.${R}`;
      } else {
        message = `${RED}Failed to resolve evolution.${R}`;
      }

      try {
        await refreshAll();
      } catch {
        message = "데이터를 불러오는 데 실패했습니다.";
      }
      lastSpecies = "";
      currentArt = null;
      first = true;
      enterRaw();
      continue;
    }

    if (key !== "\r") {
      continue;
    }

    if (panel === "party") {
      const pokemon = party[partyIndex];
      if (!pokemon) {
        continue;
      }
      const response = await apiPost("/api/game/storage/deposit", { uid: pokemon.uid });
      message = response.ok
        ? `${GRN}${pokemon.species} moved to storage.${R}`
        : `${RED}${String(response.data.error ?? "Failed to move Pokemon.")}${R}`;
    } else {
      const pokemon = storage[storageIndex];
      if (!pokemon) {
        continue;
      }
      const response = await apiPost("/api/game/storage/withdraw", { uid: pokemon.uid });
      message = response.ok
        ? `${GRN}${pokemon.species} moved to party.${R}`
        : `${RED}${String(response.data.error ?? "Failed to move Pokemon.")}${R}`;
    }

    try {
      await refreshAll();
    } catch {
      message = "데이터를 불러오는 데 실패했습니다.";
    }
    lastSpecies = "";
    currentArt = null;
    first = true;
  }

  process.stdout.write("\x1b[?25h");
}

export async function withdrawCommand(uid: string) {
  const res = await apiPost("/api/game/storage/withdraw", { uid });
  if (res.ok) {
    console.log("Pokemon moved to party.");
  } else {
    console.error(`Error: ${String(res.data.error ?? "Failed to withdraw Pokemon.")}`);
  }
}

export async function depositCommand(uid: string) {
  const res = await apiPost("/api/game/storage/deposit", { uid });
  if (res.ok) {
    console.log("Pokemon moved to storage.");
  } else {
    console.error(`Error: ${String(res.data.error ?? "Failed to deposit Pokemon.")}`);
  }
}
