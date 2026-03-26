import { getServerUrl, getCurrentServer, getToken } from "../config.js";
import { apiGet } from "../api-client.js";

export async function renderPokemonArt(species: string): Promise<void> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return;
    const res = await fetch(`${serverUrl}/api/art/${species}`);
    if (res.ok) {
      const art = await res.text();
      console.log(art);
    } else {
      console.log(`  [${species}]`);
    }
  } catch {
    console.log(`  [${species}]`);
  }
}

export async function fetchArt(species: string): Promise<string | null> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return null;
    const res = await fetch(`${serverUrl}/api/art/${species}`);
    if (res.ok) return (await res.text()).replace(/\r/g, "");
    return null;
  } catch {
    return null;
  }
}

const BALL_NAME_MAP: Record<string, string> = {
  pokeball:   "MonsterBall",
  safariball: "SafariBall",
  greatball:  "GreatBall",
  ultraball:  "UltraBall",
  masterball: "MasterBall",
};

export async function fetchBallArt(ballType: string): Promise<string | null> {
  const artName = BALL_NAME_MAP[ballType] ?? ballType.replace(/ball$/, "");
  const tryFetch = async (name: string): Promise<string | null> => {
    try {
      const serverUrl = await getServerUrl();
      if (!serverUrl) return null;
      const res = await fetch(`${serverUrl}/api/art/ball/${name}`);
      if (res.ok) return (await res.text()).replace(/\r/g, "");
      return null;
    } catch {
      return null;
    }
  };
  return (await tryFetch(artName)) ?? (artName !== "normal" ? await tryFetch("normal") : null);
}

export function renderHpBar(current: number, max: number, width: number = 20): string {
  const ratio = Math.max(0, current / max);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  let color = "\x1b[32m"; // green
  if (ratio <= 0.25) color = "\x1b[31m"; // red
  else if (ratio <= 0.5) color = "\x1b[33m"; // yellow
  return `${color}${bar}\x1b[0m ${current}/${max}`;
}

export function renderBox(lines: string[]): void {
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), 30);
  const top = "╔" + "═".repeat(maxLen + 2) + "╗";
  const bot = "╚" + "═".repeat(maxLen + 2) + "╝";
  console.log(top);
  for (const line of lines) {
    const pad = maxLen - stripAnsi(line).length;
    console.log("║ " + line + " ".repeat(pad) + " ║");
  }
  console.log(bot);
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function sideBySide(leftArt: string, rightArt: string, gap: number = 4): string {
  const leftLines = leftArt.replace(/\r/g, "").split("\n");
  const rightLines = rightArt.replace(/\r/g, "").split("\n");
  const maxLines = Math.max(leftLines.length, rightLines.length);
  const leftWidth = Math.max(...leftLines.map((l) => stripAnsi(l).length));
  const separator = " ".repeat(gap);

  // 아래쪽 정렬: 줄 수가 적은 쪽 위에 빈 줄 패딩
  const leftPadded = [...Array(maxLines - leftLines.length).fill(""), ...leftLines];
  const rightPadded = [...Array(maxLines - rightLines.length).fill(""), ...rightLines];

  const result: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    const left = leftPadded[i];
    const right = rightPadded[i];
    const pad = leftWidth - stripAnsi(left).length;
    result.push(left + " ".repeat(pad) + separator + right);
  }
  return result.join("\n");
}

// ── 2줄 헤더 시스템 ──

type ScreenName =
  | "status" | "events" | "party" | "shop" | "inventory"
  | "storage" | "pokedex" | "ranking" | "battle" | "profile"
  | "servers" | "whereami";

interface HeaderData {
  serverName: string;
  nickname: string;
  pendingEvents: number;
  points: number;
  leadPokemon: string | null;
  leadLevel: number;
  partyCount: number;
  battleActive: boolean;
}

let cachedHeaderData: HeaderData | null = null;

export async function fetchHeaderData(): Promise<HeaderData | null> {
  const token = await getToken();
  if (!token) return null;

  const server = await getCurrentServer();
  const serverName = server?.name || "?";

  try {
    const res = await apiGet("/api/game/status");
    if (!res.ok) return null;
    const d = res.data;

    const partyRes = await apiGet("/api/game/party");
    const party = (partyRes.ok ? partyRes.data.party : []) as Array<{
      species: string; level: number;
    }>;
    const lead = party[0] || null;

    cachedHeaderData = {
      serverName,
      nickname: (d.nickname as string) || "?",
      pendingEvents: (d.pendingEventCount as number) || 0,
      points: (d.points as number) || 0,
      leadPokemon: lead ? lead.species : null,
      leadLevel: lead ? lead.level : 0,
      partyCount: party.length,
      battleActive: false,
    };
    return cachedHeaderData;
  } catch {
    return cachedHeaderData;
  }
}

const DIM = "\x1b[90m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const R = "\x1b[0m";

export async function printHeader(screen: ScreenName | string | null): Promise<void> {
  const data = await fetchHeaderData();
  if (!data) return;

  // 1줄: 고정 맥락
  const screenPart = screen ? `   ${DIM}screen:${R} ${GREEN}${screen}${R}` : "";
  const line1 = `${DIM}server:${R} ${CYAN}${data.serverName}${R}   ${DIM}trainer:${R} ${YELLOW}${data.nickname}${R}${screenPart}`;

  // 2줄: 화면별 가변
  let line2: string;
  switch (screen) {
    case "events":
      line2 = `${DIM}encounters:${R} ${data.pendingEvents}   ${DIM}battle:${R} ${data.battleActive ? "전투 중" : "-"}`;
      break;
    case "party":
      line2 = `${DIM}party:${R} ${data.partyCount}/6   ${DIM}lead:${R} ${data.leadPokemon ? `${data.leadPokemon} Lv.${data.leadLevel}` : "-"}`;
      break;
    case "shop":
    case "inventory":
      line2 = `${DIM}points:${R} ${data.points}P`;
      break;
    case "battle":
      line2 = `${DIM}lead:${R} ${data.leadPokemon ? `${data.leadPokemon} Lv.${data.leadLevel}` : "-"}`;
      break;
    default:
      // status, storage, pokedex, ranking, profile, etc.
      line2 = `${DIM}encounters:${R} ${data.pendingEvents}   ${DIM}points:${R} ${data.points}P   ${DIM}lead:${R} ${data.leadPokemon ? `${data.leadPokemon} Lv.${data.leadLevel}` : "-"}`;
      break;
  }

  console.log(`  ${line1}`);
  console.log(`  ${line2}`);
  console.log();
}
