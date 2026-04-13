import { BLD, CYN, DIM, R, YEL } from "../ui/colors.js";
import { apiGet, apiPost, apiPut } from "../api-client.js";
import { fetchArt, redraw } from "../ui/display.js";
import { artToLines, padRight } from "../ui/text.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { getPendingEvolutions, resolvePendingEvolutionForPokemon } from "./evolutions.js";
import { pokemonCommand } from "./pokemon.js";

type PartyMon = {
  uid: string;
  species: string;
  level: number;
  hp: number;
  maxHp: number;
  tradeLocked?: boolean;
};

const LEFT_W = 30;
const GAP = "    ";

function buildLines(
  party: PartyMon[],
  cursor: number,
  art: string | null,
  pendingEvolutionUids: Set<string>,
  message: string,
): string[] {
  const left: string[] = [];

  for (let i = 0; i < 6; i += 1) {
    const pokemon = party[i];
    const active = i === cursor;
    const pointer = active ? `${CYN}>${R}` : " ";

    if (!pokemon) {
      left.push(`${pointer} ${DIM}(empty)${R}`);
      continue;
    }

    const name = active ? `${BLD}${pokemon.species}${R}` : pokemon.species;
    const evoBadge = pendingEvolutionUids.has(pokemon.uid) ? ` ${YEL}EVO${R}` : "";
    const lockBadge = pokemon.tradeLocked ? ` ${DIM}LOCK${R}` : "";
    left.push(`${pointer} ${padRight(name, 16)} ${DIM}Lv.${pokemon.level}${R}${evoBadge}${lockBadge}`);
  }

  const right = artToLines(art);
  const rows = Math.max(left.length, right.length);
  const merged: string[] = [];

  for (let i = 0; i < rows; i += 1) {
    const l = padRight(left[i] ?? "", LEFT_W);
    const r = right[i] ?? "";
    merged.push(`  ${l}${GAP}${r}`);
  }

  return [
    "",
    `  ${BLD}Party Pokemon${R}`,
    "  " + "-".repeat(54),
    `  ${DIM}Up/Down: Move  Enter: Open / Resolve evolution  L: Toggle trade lock  Esc: Back${R}`,
    "",
    ...merged,
    "",
    ...(message ? [`  ${message}`, ""] : []),
  ];
}

export async function partyCommand() {
  const initialParty = await apiGet("/api/game/party");
  if (!initialParty.ok) {
    console.error(`Error: ${String(initialParty.data.error ?? "Failed to load party.")}`);
    return;
  }

  const party = initialParty.data.party as PartyMon[];
  if (party.length === 0) {
    console.log("Party is empty.");
    return;
  }

  enterRaw();

  const artCache = new Map<string, string | null>();
  let pendingEvolutionUids = new Set<string>();
  let cursor = 0;
  let lineCount = 0;
  let first = true;
  let currentArt: string | null = null;
  let lastSpecies = "";
  let message = "";

  async function refreshParty() {
    const response = await apiGet("/api/game/party");
    if (response.ok) {
      const updated = response.data.party as PartyMon[];
      party.splice(0, party.length, ...updated);
    }
  }

  async function refreshPendingEvolutions() {
    const pending = await getPendingEvolutions();
    pendingEvolutionUids = new Set(pending.map((entry) => entry.pokemonUid));
  }

  await refreshPendingEvolutions();

  while (true) {
    cursor = Math.min(cursor, Math.max(0, party.length - 1));

    const species = party[cursor]?.species ?? "";
    if (species !== lastSpecies) {
      if (species && !artCache.has(species)) {
        artCache.set(species, await fetchArt(species));
      }
      currentArt = species ? (artCache.get(species) ?? null) : null;
      lastSpecies = species;
    }

    const lines = buildLines(party, cursor, currentArt, pendingEvolutionUids, message);
    lineCount = redraw(lines, lineCount, first);
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
    if (key === "\x1b[A" && cursor > 0) {
      cursor -= 1;
      continue;
    }
    if (key === "\x1b[B" && cursor < party.length - 1) {
      cursor += 1;
      continue;
    }
    if (key !== "\r") {
      if (key === "l" || key === "L") {
        const pokemon = party[cursor];
        if (!pokemon) {
          continue;
        }

        const toggleResponse = await fetchTradeLock(pokemon.uid, Boolean(pokemon.tradeLocked));
        if (toggleResponse.ok) {
          message = `${toggleResponse.data.message ?? "Trade lock updated."}`;
          await refreshParty();
          await refreshPendingEvolutions();
        } else {
          message = `${String(toggleResponse.data.error ?? "Failed to update trade lock.")}`;
        }
        continue;
      }
      continue;
    }

    const pokemon = party[cursor];
    if (!pokemon) {
      continue;
    }

    process.stdout.write("\x1b[?25h");

    const evolutionState = await resolvePendingEvolutionForPokemon(pokemon.uid);
    if (evolutionState === "not-found") {
      await pokemonCommand(pokemon.uid);
    }

    await refreshParty();
    await refreshPendingEvolutions();
    first = true;
    lastSpecies = "";
    currentArt = null;
    enterRaw();
  }

  process.stdout.write("\x1b[?25h");
}

async function fetchTradeLock(pokemonUid: string, tradeLocked: boolean) {
  return apiPost(tradeLocked ? "/api/game/trades/unlock" : "/api/game/trades/lock", { pokemonUid });
}

export async function partySetCommand(uids: string[]) {
  const res = await apiPut("/api/game/party", { uids });
  if (res.ok) {
    console.log("Party updated.");
  } else {
    console.error(`Error: ${String(res.data.error ?? "Failed to update party.")}`);
  }
}
