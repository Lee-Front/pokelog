import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "../ui/colors.js";
import { apiGet } from "../api-client.js";
import { fetchArt, stripAnsi, redraw } from "../ui/display.js";
import { encounterCommand } from "./encounter.js";

// ── stdin 유틸 ──────────────────────────────────────────────────
function enterRaw() {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function waitKey(): Promise<string> {
  return new Promise((resolve) => {
    const handler = (chunk: string) => {
      process.stdin.removeListener("data", handler);
      resolve(chunk);
    };
    process.stdin.once("data", handler);
  });
}

// ── 레이아웃 유틸 ───────────────────────────────────────────────
function visualWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const c = ch.codePointAt(0) ?? 0;
    w += (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
         (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) ||
         (c >= 0xFF01 && c <= 0xFF60) ? 2 : 1;
  }
  return w;
}

function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visualWidth(s)));
}

const LEFT_W = 38;
const GAP    = "    ";

function artToLines(art: string | null): string[] {
  return art ? art.trimEnd().split("\n") : [];
}

function mergeSideBySide(leftLines: string[], rightLines: string[]): string[] {
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padRight(leftLines[i] ?? "", LEFT_W);
    const r = rightLines[i] ?? "";
    out.push(`  ${l}${GAP}${r}`);
  }
  return out;
}

type EncounterEvent = {
  id: string;
  type: string;
  pokemon: { species: string; level: number };
  expiresAt: string;
};

function formatRemaining(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return `${RED}만료됨${R}`;
  const hours = Math.floor(remaining / 3600000);
  const mins  = Math.floor((remaining % 3600000) / 60000);
  return `${DIM}${hours}시간 ${mins}분${R}`;
}

function buildEventsLines(
  events: EncounterEvent[],
  cursor: number,
  art: string | null,
): string[] {
  const left: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const evt    = events[i];
    const active = i === cursor;
    const cur    = active ? `${CYN}❯${R}` : " ";
    const name   = active
      ? `${BLD}${evt.pokemon.species}${R}`
      : evt.pokemon.species;
    const level  = `${DIM}Lv.${evt.pokemon.level}${R}`;
    const time   = formatRemaining(evt.expiresAt);
    left.push(`${cur} ${padRight(name, 16)} ${padRight(level, 8)} ${time}`);
  }

  const right = artToLines(art);

  const lines: string[] = [
    "",
    `  ${BLD}야생 조우${R}`,
    "  " + "─".repeat(50),
    "",
    ...mergeSideBySide(left, right),
    "",
    `  ${DIM}↑↓ 탐색   Enter 전투   Esc 뒤로${R}`,
  ];
  return lines;
}

// ── 메인 ───────────────────────────────────────────────────────
export async function eventsCommand() {
  enterRaw();

  const artCache = new Map<string, string | null>();

  let events: EncounterEvent[] = [];
  let cursor    = 0;
  let lineCount = 0;
  let first     = true;
  let currentArt: string | null = null;
  let lastSpecies = "";

  async function fetchEvents() {
    const res = await apiGet("/api/game/events");
    if (!res.ok) {
      process.stdout.write(`\n  ${RED}오류: ${res.data.error}${R}\n`);
      return false;
    }
    events = res.data.events as EncounterEvent[];
    return true;
  }

  const ok = await fetchEvents();
  if (!ok) { process.stdout.write("\x1b[?25h"); return; }

  while (true) {
    cursor = Math.min(cursor, Math.max(0, events.length - 1));

    if (events.length === 0) {
      const noLines = [
        "",
        `  ${BLD}야생 조우${R}`,
        "  " + "─".repeat(50),
        "",
        `  ${DIM}야생 조우가 없습니다.${R}`,
        "",
        `  ${DIM}Esc 뒤로${R}`,
      ];
      lineCount = redraw(noLines, lineCount, first);
      first = false;
      const k = await waitKey();
      if (k === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
      break;
    }

    // 아트 캐시
    const species = events[cursor]?.pokemon.species ?? "";
    if (species !== lastSpecies) {
      if (!artCache.has(species)) {
        const art = await fetchArt(species);
        artCache.set(species, art);
      }
      currentArt  = artCache.get(species) ?? null;
      lastSpecies = species;
    }

    const lines = buildEventsLines(events, cursor, currentArt);
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();

    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") break;
    else if (key === "\x1b[A") {
      if (cursor > 0) { cursor--; }
    }
    else if (key === "\x1b[B") {
      if (cursor < events.length - 1) { cursor++; }
    }
    else if (key === "\r") {
      const evt = events[cursor];
      if (!evt) continue;

      // 만료된 이벤트는 무시
      const remaining = new Date(evt.expiresAt).getTime() - Date.now();
      if (remaining <= 0) continue;

      // encounterCommand 호출 — raw mode는 그대로 유지됨
      await encounterCommand(evt.id, evt.pokemon);

      // 복귀 후 이벤트 목록 갱신
      first = true;
      lastSpecies = "";
      currentArt = null;
      await fetchEvents();
    }
  }

  process.stdout.write("\x1b[?25h");
}
