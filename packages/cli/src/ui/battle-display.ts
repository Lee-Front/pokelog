import { CYN, DIM, GRN, RED, YEL, R } from "./colors.js";
import { renderHpBar } from "./display.js";
import { padRight } from "./text.js";
import { getServerUrl } from "../config.js";
import type {
  PvpClientRoomView, PvpPlayerState, PvpPokemon, PvpTransformationType,
} from "../../../../shared/pvp-types.js";
import type { StatStages, VolatileStatus, PrimaryStatus, PokemonGender } from "../../../../shared/types.js";

// ── Type color palette (256-color) ──
export const TYPE_COLORS: Record<string, string> = {
  normal:   "\x1b[38;5;250m",
  fire:     "\x1b[38;5;202m",
  water:    "\x1b[38;5;33m",
  electric: "\x1b[38;5;226m",
  grass:    "\x1b[38;5;34m",
  ice:      "\x1b[38;5;87m",
  fighting: "\x1b[38;5;124m",
  poison:   "\x1b[38;5;129m",
  ground:   "\x1b[38;5;137m",
  flying:   "\x1b[38;5;153m",
  psychic:  "\x1b[38;5;198m",
  bug:      "\x1b[38;5;112m",
  rock:     "\x1b[38;5;138m",
  ghost:    "\x1b[38;5;91m",
  dragon:   "\x1b[38;5;57m",
  dark:     "\x1b[38;5;240m",
  steel:    "\x1b[38;5;245m",
  fairy:    "\x1b[38;5;219m",
  stellar:  "\x1b[38;5;117m",
};

export const TYPE_ABBR: Record<string, string> = {
  normal: "Normal", fire: "Fire", water: "Water", electric: "Elec",
  grass: "Grass", ice: "Ice", fighting: "Fight", poison: "Poison",
  ground: "Ground", flying: "Flying", psychic: "Psyc", bug: "Bug",
  rock: "Rock", ghost: "Ghost", dragon: "Dragon", dark: "Dark",
  steel: "Steel", fairy: "Fairy", stellar: "Stellar",
};

export function colorizeType(type: string): string {
  const color = TYPE_COLORS[type] ?? "";
  const label = TYPE_ABBR[type] ?? type;
  return `${color}${label}${R}`;
}

// ── Move catalog cache (fetched from server on demand) ──
export interface MoveInfo {
  id: string;
  name: string;
  type: string;
  category: "physical" | "special" | "status";
  power: number;
  accuracy: number;
  pp: number;
  priority?: number;
}

let moveCatalogCache: Map<string, MoveInfo> | null = null;
let moveFetchInFlight: Promise<Map<string, MoveInfo>> | null = null;

export async function loadMoveCatalog(): Promise<Map<string, MoveInfo>> {
  if (moveCatalogCache) return moveCatalogCache;
  if (moveFetchInFlight) return moveFetchInFlight;

  moveFetchInFlight = (async () => {
    try {
      const url = await getServerUrl();
      if (!url) { moveCatalogCache = new Map(); return moveCatalogCache; }
      const res = await fetch(`${url}/api/moves/catalog`);
      if (!res.ok) { moveCatalogCache = new Map(); return moveCatalogCache; }
      const data = (await res.json()) as { moves: MoveInfo[] };
      const m = new Map<string, MoveInfo>();
      for (const move of data.moves) m.set(move.id, move);
      moveCatalogCache = m;
      return m;
    } catch {
      moveCatalogCache = new Map();
      return moveCatalogCache;
    } finally {
      moveFetchInFlight = null;
    }
  })();
  return moveFetchInFlight;
}

export function getMoveInfo(id: string): MoveInfo | undefined {
  return moveCatalogCache?.get(id);
}

export function formatMoveInfo(info?: MoveInfo): string {
  if (!info) return `${DIM}---${R}`;
  const typeStr = colorizeType(info.type);
  const cat = info.category === "physical" ? "Phys"
    : info.category === "special" ? "Spec" : "Stat";
  const power = info.power > 0 ? String(info.power) : "-";
  return `${typeStr} ${cat.padEnd(4)} ${power.padStart(3)}`;
}

// ── Stat stages formatting ──
const STAT_LABEL: Record<keyof StatStages, string> = {
  attack: "Atk", defense: "Def", spAttack: "SpA", spDefense: "SpD",
  speed: "Spd", accuracy: "Acc", evasion: "Eva",
};

export function formatStatStages(stages: StatStages | undefined): string {
  if (!stages) return "";
  const parts: string[] = [];
  (Object.keys(stages) as Array<keyof StatStages>).forEach((k) => {
    const v = stages[k];
    if (v !== 0) {
      const sign = v > 0 ? "+" : "";
      const color = v > 0 ? GRN : RED;
      parts.push(`${color}${sign}${v} ${STAT_LABEL[k]}${R}`);
    }
  });
  return parts.join(" ");
}

// ── Volatile formatting ──
const VOLATILE_SHORT: Record<string, string> = {
  confusion: "Confusion",
  "leech-seed": "LeechSeed",
  infatuation: "Infatuation",
  curse: "Curse",
  encore: "Encore",
  disable: "Disable",
  taunt: "Taunt",
  "perish-song": "Perish",
  torment: "Torment",
  "heal-block": "HealBlock",
  embargo: "Embargo",
  nightmare: "Nightmare",
  "aqua-ring": "AquaRing",
  ingrain: "Ingrain",
  "magnet-rise": "MagnetRise",
  substitute: "Sub",
  "focus-energy": "FocusEnergy",
  "stockpile-1": "Stockpile1",
  "stockpile-2": "Stockpile2",
  "stockpile-3": "Stockpile3",
  protect: "Protect",
  endure: "Endure",
  flinch: "Flinch",
  "destiny-bond": "DestinyBond",
  grudge: "Grudge",
};

function shortVolatile(id: string): string {
  return VOLATILE_SHORT[id] ?? id;
}

export function formatVolatiles(volatiles: VolatileStatus[] | undefined): string {
  if (!volatiles || volatiles.length === 0) return "";
  return volatiles.map((v) => {
    const label = shortVolatile(v.id);
    const turns = v.turnsRemaining > 0 ? `(${v.turnsRemaining}T)` : "";
    return `${CYN}${label}${turns}${R}`;
  }).join(" ");
}

// ── Status formatting ──
const STATUS_LABEL: Record<PrimaryStatus, string> = {
  burn: "BRN", poison: "PSN", paralysis: "PAR", sleep: "SLP", freeze: "FRZ",
};
const STATUS_COLOR: Record<PrimaryStatus, string> = {
  burn: RED, poison: "\x1b[35m", paralysis: YEL, sleep: DIM, freeze: CYN,
};

export function formatStatus(
  status: PrimaryStatus | null | undefined,
  toxicCounter?: number,
  sleepTurns?: number,
): string {
  if (!status) return "";
  const label = STATUS_LABEL[status];
  const color = STATUS_COLOR[status];
  let extra = "";
  if (status === "poison" && toxicCounter && toxicCounter > 0) {
    extra = `(Toxic x${toxicCounter})`;
  } else if (status === "sleep" && sleepTurns && sleepTurns > 0) {
    extra = `(${sleepTurns}T)`;
  }
  return `${color}${label}${extra}${R}`;
}

function genderSymbol(g: PokemonGender | null | undefined): string {
  if (g === "male") return `${CYN}M${R}`;
  if (g === "female") return `${RED}F${R}`;
  return `${DIM}-${R}`;
}

// ── Transformation label ──
function transformationLabel(trans: PvpTransformationType | null | undefined, gmaxTurns?: number, teraType?: string | null): string {
  if (!trans) return "";
  switch (trans) {
    case "mega":        return `${YEL}[MEGA]${R}`;
    case "gigantamax":  return `${YEL}[GMAX ${gmaxTurns ?? 3}T]${R}`;
    case "primal":      return `${YEL}[PRIMAL]${R}`;
    case "dynamax":     return `${YEL}[DMAX ${gmaxTurns ?? 3}T]${R}`;
    case "ultra-burst": return `${YEL}[ULTRA]${R}`;
    case "tera": {
      const t = teraType ? TYPE_ABBR[teraType] ?? teraType : "";
      const color = teraType ? TYPE_COLORS[teraType] ?? YEL : YEL;
      return `${color}[TERA${t ? " " + t : ""}]${R}`;
    }
  }
}

// ── Pokemon panel ──
export interface PokemonPanelInput {
  poke: PvpPokemon;
  transformationType?: PvpTransformationType | null;
  gmaxTurnsRemaining?: number;
  statStages?: StatStages;
  volatiles?: VolatileStatus[];
  substitute?: number;
  teraActive?: boolean;
  isOpponent: boolean;
}

export function formatPokemonPanel(input: PokemonPanelInput): string[] {
  const { poke, transformationType, gmaxTurnsRemaining, statStages, volatiles, substitute, teraActive, isOpponent } = input;
  const nameColor = isOpponent ? CYN : GRN;
  const header = isOpponent ? `${DIM}상대${R}` : `${DIM}나${R}  `;
  const transLabel = transformationLabel(transformationType, gmaxTurnsRemaining, teraActive ? poke.teraType : null);
  const genderStr = poke.gender ? ` ${genderSymbol(poke.gender)}` : "";
  const nameLine = `  ${header}  ${nameColor}${poke.species}${R}${transLabel ? " " + transLabel : ""} Lv.${poke.level}${genderStr}`;
  const hpLine = `        ${renderHpBar(poke.hp, poke.maxHp, 14)}`;

  const lines = [nameLine, hpLine];

  // Status + volatiles
  const statusStr = formatStatus(poke.statusCondition, poke.toxicCounter, poke.sleepTurns);
  const volatilesStr = formatVolatiles(volatiles);
  const subStr = substitute && substitute > 0 ? `${YEL}Sub:${substitute}${R}` : "";
  const statusParts = [statusStr, volatilesStr, subStr].filter(Boolean);
  if (statusParts.length > 0) {
    lines.push(`        ${statusParts.join(" ")}`);
  }

  // Stat stages
  const stagesStr = formatStatStages(statStages);
  if (stagesStr) lines.push(`        ${stagesStr}`);

  return lines;
}

// ── Field effects ──
const WEATHER_LABEL: Record<string, string> = {
  sun: "Sun", rain: "Rain", hail: "Hail", sandstorm: "Sand",
};
const WEATHER_COLOR: Record<string, string> = {
  sun: YEL, rain: CYN, hail: "\x1b[38;5;87m", sandstorm: "\x1b[38;5;137m",
};

const TERRAIN_LABEL: Record<string, string> = {
  electric: "Electric", grassy: "Grassy", psychic: "Psychic", misty: "Misty",
};
const TERRAIN_COLOR: Record<string, string> = {
  electric: YEL, grassy: GRN, psychic: "\x1b[38;5;198m", misty: "\x1b[38;5;219m",
};

export function formatFieldEffects(state: PvpClientRoomView): string[] {
  const out: string[] = [];

  // Global field effects
  const globals: string[] = [];
  if (state.weather) {
    const lbl = WEATHER_LABEL[state.weather] ?? state.weather;
    const col = WEATHER_COLOR[state.weather] ?? "";
    const t = state.weatherTurns ? ` ${state.weatherTurns}T` : "";
    globals.push(`${col}[${lbl}${t}]${R}`);
  }
  if (state.terrain) {
    const lbl = TERRAIN_LABEL[state.terrain] ?? state.terrain;
    const col = TERRAIN_COLOR[state.terrain] ?? "";
    const t = state.terrainTurns ? ` ${state.terrainTurns}T` : "";
    globals.push(`${col}[${lbl}${t}]${R}`);
  }
  if (state.trickRoom && state.trickRoom > 0) {
    globals.push(`${YEL}[TrickRoom ${state.trickRoom}T]${R}`);
  }
  if (state.magicRoom && state.magicRoom > 0) {
    globals.push(`${YEL}[MagicRoom ${state.magicRoom}T]${R}`);
  }
  if (state.wonderRoom && state.wonderRoom > 0) {
    globals.push(`${YEL}[WonderRoom ${state.wonderRoom}T]${R}`);
  }
  if (globals.length > 0) out.push(`  ${globals.join(" ")}`);

  // Per-side effects
  const mySide = formatSideEffects(state.me, "내 쪽");
  if (mySide) out.push(mySide);
  const oppSide = formatSideEffectsOpp(state.opponent, "상대 쪽");
  if (oppSide) out.push(oppSide);

  return out;
}

function formatSideEffects(player: PvpPlayerState, label: string): string | null {
  const parts: string[] = [];
  // Hazards
  if (player.hazards?.stealthRock) parts.push(`${DIM}[SR]${R}`);
  if (player.hazards?.spikes && player.hazards.spikes > 0) {
    parts.push(`${DIM}[Spikes x${player.hazards.spikes}]${R}`);
  }
  if (player.hazards?.toxicSpikes && player.hazards.toxicSpikes > 0) {
    parts.push(`${DIM}[ToxSpikes x${player.hazards.toxicSpikes}]${R}`);
  }
  if (player.hazards?.stickyWeb) parts.push(`${DIM}[Web]${R}`);
  // Screens
  if (player.screens?.reflect && player.screens.reflect > 0) {
    parts.push(`${YEL}[Reflect ${player.screens.reflect}T]${R}`);
  }
  if (player.screens?.lightScreen && player.screens.lightScreen > 0) {
    parts.push(`${YEL}[LightScreen ${player.screens.lightScreen}T]${R}`);
  }
  if (player.screens?.auroraVeil && player.screens.auroraVeil > 0) {
    parts.push(`${YEL}[AuroraVeil ${player.screens.auroraVeil}T]${R}`);
  }
  // Tailwind
  if (player.tailwind && player.tailwind > 0) {
    parts.push(`${CYN}[Tailwind ${player.tailwind}T]${R}`);
  }
  if (parts.length === 0) return null;
  return `  ${DIM}${label}:${R} ${parts.join(" ")}`;
}

function formatSideEffectsOpp(opp: PvpClientRoomView["opponent"], label: string): string | null {
  const parts: string[] = [];
  if (opp.hazards?.stealthRock) parts.push(`${DIM}[SR]${R}`);
  if (opp.hazards?.spikes && opp.hazards.spikes > 0) {
    parts.push(`${DIM}[Spikes x${opp.hazards.spikes}]${R}`);
  }
  if (opp.hazards?.toxicSpikes && opp.hazards.toxicSpikes > 0) {
    parts.push(`${DIM}[ToxSpikes x${opp.hazards.toxicSpikes}]${R}`);
  }
  if (opp.hazards?.stickyWeb) parts.push(`${DIM}[Web]${R}`);
  if (opp.screens?.reflect && opp.screens.reflect > 0) {
    parts.push(`${YEL}[Reflect ${opp.screens.reflect}T]${R}`);
  }
  if (opp.screens?.lightScreen && opp.screens.lightScreen > 0) {
    parts.push(`${YEL}[LightScreen ${opp.screens.lightScreen}T]${R}`);
  }
  if (opp.screens?.auroraVeil && opp.screens.auroraVeil > 0) {
    parts.push(`${YEL}[AuroraVeil ${opp.screens.auroraVeil}T]${R}`);
  }
  if (opp.tailwind && opp.tailwind > 0) {
    parts.push(`${CYN}[Tailwind ${opp.tailwind}T]${R}`);
  }
  if (parts.length === 0) return null;
  return `  ${DIM}${label}:${R} ${parts.join(" ")}`;
}

// ── Party status line (my side) ──
export function formatPartyStatus(state: PvpClientRoomView): string {
  const items = state.me.party.map((p, i) => {
    const marker =
      i === state.me.activeIndex ? `${GRN}●${R}` :
      p.hp > 0 ? `${DIM}○${R}` : `${RED}×${R}`;
    const name = padRight(p.species.slice(0, 10), 10);
    const hpPct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 100) : 0;
    const hpText = p.hp > 0 ? `HP:${hpPct}` : "FNT";
    const statusAbbr = p.statusCondition ? ` ${STATUS_LABEL[p.statusCondition]}` : "";
    return `[${marker}${name} ${hpText}${statusAbbr}]`;
  });
  return `  ${DIM}내 파티:${R} ${items.join(" ")}`;
}

// ── Party status line (opp side) ──
export function formatOppPartyStatus(state: PvpClientRoomView): string {
  const ratios = state.opponent.partyHpRatios;
  const items = ratios.map((r, i) => {
    // Active index unknown, but we know activePokemon; match by index where ratio matches active hp/maxHp
    const active = state.opponent.activePokemon;
    const isActive = active != null && i === guessActiveIndex(state);
    const marker =
      isActive ? `${CYN}●${R}` :
      r > 0 ? `${DIM}○${R}` : `${RED}×${R}`;
    const pct = Math.round(r * 100);
    const hpText = r > 0 ? `HP:${pct}%` : "FNT";
    return `[${marker}hidden ${hpText}]`;
  });
  return `  ${DIM}상대 파티:${R} ${items.join(" ")}`;
}

function guessActiveIndex(state: PvpClientRoomView): number {
  const active = state.opponent.activePokemon;
  if (!active) return -1;
  const ratios = state.opponent.partyHpRatios;
  const activeRatio = active.maxHp > 0 ? active.hp / active.maxHp : 0;
  // Best-effort match
  for (let i = 0; i < ratios.length; i++) {
    if (Math.abs(ratios[i] - activeRatio) < 0.001) return i;
  }
  return -1;
}

// Utility so tests / consumers can reset cache
export function __resetMoveCatalogCache(): void {
  moveCatalogCache = null;
  moveFetchInFlight = null;
}
