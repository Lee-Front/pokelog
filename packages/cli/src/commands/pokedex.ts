import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "../ui/colors.js";
import { apiGet } from "../api-client.js";
import { fetchArt, stripAnsi, redraw } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";

type SpeciesEntry = { id: number; species: string; name: string };

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

// ANSI 색상 제거 후 회색 적용 → 실루엣 효과
function silhouetteArt(art: string): string {
  return art
    .split("\n")
    .map(l => `${DIM}${l.replace(/\x1b\[[0-9;]*m/g, "")}${R}`)
    .join("\n");
}

function artToLines(art: string | null): string[] {
  return art ? art.trimEnd().split("\n") : [];
}

const LIST_W  = 28;   // 좌측 목록 패널 시각폭
const GAP     = "   ";
const VISIBLE = 14;   // 목록 표시 줄 수

function buildLines(
  allSpecies: SpeciesEntry[],
  cursor: number,
  scroll: number,
  seenSet: Set<string>,
  caughtSet: Set<string>,
  art: string | null,
  isSeen: boolean,
): string[] {
  // ── 좌측: 목록 + 통계 + 힌트 ─────────────────────────────────
  const left: string[] = [
    `${BLD}포켓몬 도감${R}  ${DIM}(${allSpecies.length}종)${R}`,
    "─".repeat(LIST_W),
  ];

  const end = Math.min(scroll + VISIBLE, allSpecies.length);
  for (let i = scroll; i < end; i++) {
    const entry  = allSpecies[i];
    const seen   = seenSet.has(entry.species);
    const caught = caughtSet.has(entry.species);
    const active = i === cursor;

    const cur     = active ? `${CYN}❯${R}` : " ";
    const num     = `${DIM}${String(entry.id).padStart(3, "0")}${R}`;
    const nameStr = seen ? entry.name : "???";
    const name    = active
      ? `${CYN}${BLD}${nameStr}${R}`
      : seen
        ? nameStr
        : `${DIM}${nameStr}${R}`;
    const mark = caught ? ` ${GRN}✓${R}` : "";

    left.push(`${cur} ${num} ${padRight(name, 14)}${mark}`);
  }

  // 목록 패딩
  while (left.length < 2 + VISIBLE) left.push("");

  left.push("─".repeat(LIST_W));
  left.push(`  ${DIM}발견${R}  ${BLD}${seenSet.size}${R}종   ${DIM}포획${R}  ${BLD}${caughtSet.size}${R}종`);
  left.push(`  ${DIM}↑↓ 탐색   Esc 뒤로${R}`);

  // ── 우측: 아트 ───────────────────────────────────────────────
  const displayArt = art
    ? (isSeen ? artToLines(art) : artToLines(silhouetteArt(art)))
    : [];

  // ── 병합 ──────────────────────────────────────────────────
  const rows = Math.max(left.length, displayArt.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padRight(left[i] ?? "", LIST_W);
    const r = displayArt[i] ?? "";
    lines.push(`  ${l}${GAP}${r}`);
  }
  return lines;
}

export async function pokedexCommand() {
  enterRaw();

  const res = await apiGet("/api/game/pokedex");
  if (!res.ok) {
    process.stdout.write(`\n  오류: ${(res.data as { error: string }).error}\n`);
    return;
  }

  const { seen, caught, allSpecies } = res.data as {
    seen: string[];
    caught: string[];
    allSpecies: SpeciesEntry[];
  };

  allSpecies.sort((a, b) => a.id - b.id);

  const seenSet   = new Set(seen);
  const caughtSet = new Set(caught);

  const artCache  = new Map<string, string | null>();
  let cursor      = 0;
  let scroll      = 0;
  let first       = true;
  let lineCount   = 0;
  let currentArt: string | null = null;
  let lastSpecies = "";

  while (true) {
    const entry  = allSpecies[cursor];
    const isSeen = seenSet.has(entry.species);

    if (entry.species !== lastSpecies) {
      if (!artCache.has(entry.species)) {
        artCache.set(entry.species, await fetchArt(entry.species));
      }
      currentArt  = artCache.get(entry.species) ?? null;
      lastSpecies = entry.species;
    }

    const lines = buildLines(allSpecies, cursor, scroll, seenSet, caughtSet, currentArt, isSeen);
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    if (key === "\x1b" || key === "q") break;

    if (key === "\x1b[A") {
      if (cursor > 0) {
        cursor--;
        if (cursor < scroll) scroll = cursor;
      }
    } else if (key === "\x1b[B") {
      if (cursor < allSpecies.length - 1) {
        cursor++;
        if (cursor >= scroll + VISIBLE) scroll = cursor - VISIBLE + 1;
      }
    }
  }

  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
}
