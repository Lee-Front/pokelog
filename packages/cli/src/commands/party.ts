import { apiGet, apiPut } from "../api-client.js";
import { fetchArt, stripAnsi } from "../ui/display.js";
import { pokemonCommand } from "./pokemon.js";

const DIM = "\x1b[90m";
const CYN = "\x1b[36m";
const BLD = "\x1b[1m";
const R   = "\x1b[0m";

type PartyMon = { uid: string; species: string; level: number; hp: number; maxHp: number };

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

const LEFT_W = 26;
const GAP    = "    ";

function artToLines(art: string | null): string[] {
  return art ? art.trimEnd().split("\n") : [];
}

function buildLines(party: PartyMon[], cursor: number, art: string | null): string[] {
  const left: string[] = [];

  for (let i = 0; i < 6; i++) {
    const p      = party[i];
    const active = i === cursor;
    const cur    = active ? `${CYN}❯${R}` : " ";
    if (p) {
      const name = active ? `${BLD}${p.species}${R}` : p.species;
      left.push(`${cur} ${padRight(name, 14)} ${DIM}Lv.${p.level}${R}`);
    } else {
      left.push(`${cur} ${DIM}(빈 슬롯)${R}`);
    }
  }

  const right = artToLines(art);
  const rows  = Math.max(left.length, right.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padRight(left[i] ?? "", LEFT_W);
    const r = right[i] ?? "";
    merged.push(`  ${l}${GAP}${r}`);
  }

  return [
    "",
    `  ${BLD}파티 포켓몬${R}`,
    "  " + "─".repeat(50),
    `  ${DIM}↑↓ 탐색   Enter 상세   Esc 뒤로${R}`,
    "",
    ...merged,
    "",
  ];
}

function redraw(lines: string[], lineCount: number, first: boolean): number {
  let out = "\x1b[?25l";
  if (first || lineCount !== lines.length) {
    out += "\x1b[2J\x1b[H";
    out += lines.map(l => l + "\x1b[0m").join("\n") + "\n";
  } else {
    out += `\x1b[${lineCount}A`;
    out += lines.map(l => "\r" + l + "\x1b[0m\x1b[K").join("\n") + "\n";
  }
  out += "\x1b[?25h";
  process.stdout.write(out);
  return lines.length;
}

// ── 메인 ───────────────────────────────────────────────────────
export async function partyCommand() {
  const res = await apiGet("/api/game/party");
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const party = res.data.party as PartyMon[];

  if (party.length === 0) {
    console.log("파티가 비어 있습니다.");
    return;
  }

  enterRaw();

  const artCache  = new Map<string, string | null>();
  let cursor      = 0;
  let lineCount   = 0;
  let first       = true;
  let currentArt: string | null = null;
  let lastSpecies = "";

  while (true) {
    cursor = Math.min(cursor, party.length - 1);

    const species = party[cursor]?.species ?? "";
    if (species !== lastSpecies) {
      if (species && !artCache.has(species)) {
        artCache.set(species, await fetchArt(species));
      }
      currentArt  = species ? (artCache.get(species) ?? null) : null;
      lastSpecies = species;
    }

    const lines = buildLines(party, cursor, currentArt);
    lineCount   = redraw(lines, lineCount, first);
    first       = false;

    const key = await waitKey();

    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") break;
    else if (key === "\x1b[A") { if (cursor > 0) cursor--; }
    else if (key === "\x1b[B") { if (cursor < party.length - 1) cursor++; }
    else if (key === "\r") {
      const p = party[cursor];
      if (!p) continue;
      process.stdout.write("\x1b[?25h");
      await pokemonCommand(p.uid);
      // 상세 화면에서 돌아온 후 파티 재조회
      const fresh = await apiGet("/api/game/party");
      if (fresh.ok) {
        const updated = fresh.data.party as PartyMon[];
        party.splice(0, party.length, ...updated);
      }
      first       = true;
      lastSpecies = "";
      currentArt  = null;
      enterRaw();
    }
  }

  process.stdout.write("\x1b[?25h");
}

export async function partySetCommand(uids: string[]) {
  const res = await apiPut("/api/game/party", { uids });
  if (res.ok) {
    console.log("파티 편성 완료!");
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
