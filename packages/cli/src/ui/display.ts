import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "./colors.js";
import { stripAnsi } from "./text.js";
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

export async function fetchEggArt(name: string): Promise<string | null> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return null;
    const res = await fetch(`${serverUrl}/api/art/egg/${name}`);
    if (res.ok) return (await res.text()).replace(/\r/g, "");
    return null;
  } catch {
    return null;
  }
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

export { stripAnsi } from "./text.js";

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

interface HeaderData {
  serverName: string;
  nickname: string;
  region: string;
  pendingEvents: number;
  points: number;
  leadPokemon: string | null;
  leadLevel: number;
  partyCount: number;
  online: boolean;
}

let cachedHeaderData: HeaderData | null = null;

export function invalidateHeaderCache(): void {
  cachedHeaderData = null;
}

export async function fetchHeaderData(): Promise<HeaderData> {
  const server = await getCurrentServer();
  const serverName = server?.name || "?";

  const fallback: HeaderData = {
    serverName,
    nickname: "?",
    region: "-",
    pendingEvents: 0,
    points: 0,
    leadPokemon: null,
    leadLevel: 0,
    partyCount: 0,
    online: false,
  };

  const token = await getToken();
  if (!token) return cachedHeaderData ?? fallback;

  try {
    const res = await apiGet("/api/game/status");
    if (!res.ok) {
      if (res.status === 0) return { ...fallback, online: false };
      return cachedHeaderData ?? fallback;
    }
    const d = res.data;

    const partyRes = await apiGet("/api/game/party");
    const party = (partyRes.ok ? partyRes.data.party : []) as Array<{
      species: string; level: number;
    }>;
    const lead = party[0] || null;

    cachedHeaderData = {
      serverName,
      nickname: (d.nickname as string) || "?",
      region: (d.region as string) || "default",
      pendingEvents: (d.pendingEventCount as number) || 0,
      points: (d.points as number) || 0,
      leadPokemon: lead ? lead.species : null,
      leadLevel: lead ? lead.level : 0,
      partyCount: party.length,
      online: true,
    };
    return cachedHeaderData;
  } catch {
    return cachedHeaderData ?? fallback;
  }
}

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";

export async function printHeader(screen: string | null): Promise<void> {
  const data = await fetchHeaderData();

  const status = data.online ? `${GRN}●${R}` : `${RED}● 오프라인${R}`;
  const line1 = `${DIM}server:${R} ${CYAN}${data.serverName}${R} ${status}   ${DIM}trainer:${R} ${YELLOW}${data.nickname}${R}   ${DIM}location:${R} ${GREEN}${data.region}${R}`;
  const line2 = data.online
    ? `${DIM}encounters:${R} ${data.pendingEvents}   ${DIM}points:${R} ${data.points}P   ${DIM}lead:${R} ${data.leadPokemon ? `${data.leadPokemon} Lv.${data.leadLevel}` : "-"}`
    : `${RED}서버에 연결할 수 없습니다.${R}`;

  console.log(`  ${line1}`);
  console.log(`  ${line2}`);
  console.log();
}

/**
 * 깜빡임 없는 화면 다시 그리기 (공통 유틸)
 *
 * - first=true  : 전체 지우기 후 새로 그림
 * - first=false : 이전 줄로 커서 이동 후 line-by-line 덮어쓰기
 *   - 줄 수가 늘어난 경우 → 아래로 자연스럽게 확장
 *   - 줄 수가 줄어든 경우 → 남은 이전 줄을 지우고 커서 재조정
 *
 * @returns 새로운 lineCount (다음 호출 시 전달)
 */
export function redraw(lines: string[], lineCount: number, first: boolean): number {
  let out = "\x1b[?25l"; // 커서 숨기기
  if (first) {
    out += "\x1b[2J\x1b[H";
    out += lines.map(l => l + "\x1b[0m").join("\n") + "\n";
  } else {
    if (lineCount > 0) out += `\x1b[${lineCount}A`;
    out += lines.map(l => "\r" + l + "\x1b[0m\x1b[K").join("\n") + "\n";
    // 줄 수가 줄었을 경우 남은 이전 줄 지우고 커서 재조정
    if (lines.length < lineCount) {
      const extra = lineCount - lines.length;
      for (let i = 0; i < extra; i++) out += "\r\x1b[K\n";
      out += `\x1b[${extra}A`;
    }
  }
  out += "\x1b[?25h"; // 커서 보이기
  process.stdout.write(out);
  return lines.length;
}
