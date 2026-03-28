import { apiGet, apiPost } from "../api-client.js";
import { fetchArt } from "../ui/display.js";

const DIM = "\x1b[90m";
const YEL = "\x1b[1m\x1b[33m";
const GRN = "\x1b[32m";
const RED = "\x1b[31m";
const CYN = "\x1b[36m";
const BLD = "\x1b[1m";
const R   = "\x1b[0m";

type PokemonEntry = { uid: string; species: string; level: number; hp: number; maxHp: number };

function stripAnsi(s: string) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }

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

function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visualWidth(s)));
}

// ── stdin 유틸 ──────────────────────────────────────────────────
function enterRaw() {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function waitKey(): Promise<string> {
  return new Promise((resolve) => {
    const handler = (chunk: string) => { process.stdin.removeListener("data", handler); resolve(chunk); };
    process.stdin.once("data", handler);
  });
}

// ── 데이터 fetch ────────────────────────────────────────────────
async function fetchData(): Promise<{ party: PokemonEntry[]; storage: PokemonEntry[] } | null> {
  const [a, b] = await Promise.all([apiGet("/api/game/party"), apiGet("/api/game/storage")]);
  if (!a.ok || !b.ok) return null;
  return { party: a.data.party as PokemonEntry[], storage: b.data.storage as PokemonEntry[] };
}

// ── 아트 캐시 ───────────────────────────────────────────────────
const artCache = new Map<string, string | null>();

async function getCachedArt(species: string): Promise<string | null> {
  if (artCache.has(species)) return artCache.get(species)!;
  const art = await fetchArt(species);
  artCache.set(species, art);
  return art;
}

// ── 화면 그리기 ─────────────────────────────────────────────────
const PARTY_W   = 22;
const STORAGE_W = 22;
const GAP       = "   ";

function artToLines(art: string | null): string[] {
  return art ? art.trimEnd().split("\n") : [];
}

function buildLines(
  party: PokemonEntry[],
  storage: PokemonEntry[],
  panel: "party" | "storage",
  pi: number,
  si: number,
  art: string | null,
  msg: string,
): string[] {
  // 파티 열
  const partyLines: string[] = [];
  const partyHdr = panel === "party" ? `${CYN}${BLD}── 파티 (${party.length}/6) ──${R}` : `${YEL}── 파티 (${party.length}/6) ──${R}`;
  partyLines.push(partyHdr);
  for (let i = 0; i < 6; i++) {
    const p = party[i];
    const active = panel === "party" && i === pi;
    const cur = active ? `${CYN}❯${R}` : " ";
    if (p) {
      const name = active ? `${BLD}${p.species}${R}` : p.species;
      partyLines.push(`${cur} ${padEnd(name, 13)} ${DIM}Lv.${p.level}${R}`);
    } else {
      partyLines.push(`${cur} ${DIM}(빈 슬롯)${R}`);
    }
  }

  // 보관함 열
  const storageLines: string[] = [];
  const storHdr = panel === "storage" ? `${CYN}${BLD}── 보관함 (${storage.length}마리) ──${R}` : `${DIM}── 보관함 (${storage.length}마리) ──${R}`;
  storageLines.push(storHdr);
  if (storage.length === 0) {
    storageLines.push(`  ${DIM}비어 있습니다.${R}`);
  } else {
    for (let i = 0; i < storage.length; i++) {
      const p = storage[i];
      const active = panel === "storage" && i === si;
      const cur = active ? `${CYN}❯${R}` : " ";
      const name = active ? `${BLD}${p.species}${R}` : p.species;
      storageLines.push(`${cur} ${padEnd(name, 13)} ${DIM}Lv.${p.level}${R}`);
    }
  }

  // 이미지 열
  const artLines = artToLines(art);

  // 3열 병합
  const rows = Math.max(partyLines.length, storageLines.length, artLines.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padEnd(partyLines[i]   ?? "", PARTY_W);
    const m = padEnd(storageLines[i] ?? "", STORAGE_W);
    const r = artLines[i] ?? "";
    merged.push(`  ${l}${GAP}${m}${GAP}${r}`);
  }

  const lines: string[] = [
    "",
    `  ${BLD}보관함 관리${R}   ${DIM}파티 ${party.length}/6  ·  보관함 ${storage.length}마리${R}`,
    "  " + "─".repeat(50),
    `  ${DIM}↑↓ 이동   ←→ 패널 전환   Enter 이동   Esc 뒤로${R}`,
    "",
    ...merged,
    "",
  ];

  if (msg) { lines.push(`  ${msg}`); }
  return lines;
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

function getSelectedSpecies(
  party: PokemonEntry[],
  storage: PokemonEntry[],
  panel: "party" | "storage",
  pi: number,
  si: number,
): string | null {
  if (panel === "party") return party[pi]?.species ?? null;
  return storage[si]?.species ?? null;
}

// ── 메인 ───────────────────────────────────────────────────────
export async function storageCommand() {
  enterRaw();

  let panel: "party" | "storage" = "party";
  let pi = 0;
  let si = 0;
  let msg = "";
  let lineCount = 0;
  let first = true;
  let currentArt: string | null = null;
  let lastSpecies: string | null = null;

  let data = await fetchData();
  if (!data) { process.stdout.write("  오류: 데이터를 불러올 수 없습니다.\n"); return; }

  while (true) {
    const { party, storage } = data;

    // 커서 범위 보정
    if (panel === "party") pi = Math.min(pi, Math.max(0, party.length - 1));
    if (panel === "storage") si = Math.min(si, Math.max(0, storage.length - 1));

    // 선택된 포켓몬 아트 fetch (캐시 활용)
    const species = getSelectedSpecies(party, storage, panel, pi, si);
    if (species && species !== lastSpecies) {
      currentArt = await getCachedArt(species);
      lastSpecies = species;
    } else if (!species) {
      currentArt = null;
      lastSpecies = null;
    }

    const lines = buildLines(party, storage, panel, pi, si, currentArt, msg);
    lineCount = redraw(lines, lineCount, first);
    first = false;
    msg = "";

    const key = await waitKey();

    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") break;

    else if (key === "\x1b[A") {
      if (panel === "party" && pi > 0) pi--;
      else if (panel === "storage" && si > 0) si--;
    }
    else if (key === "\x1b[B") {
      if (panel === "party" && pi < party.length - 1) pi++;
      else if (panel === "storage" && si < storage.length - 1) si++;
    }
    else if (key === "\x1b[D") {
      panel = "party";
      pi = Math.min(pi, Math.max(0, party.length - 1));
    }
    else if (key === "\x1b[C") {
      if (storage.length > 0) panel = "storage";
    }
    else if (key === "\r") {
      if (panel === "party") {
        const p = party[pi];
        if (!p) continue;
        const res = await apiPost("/api/game/storage/deposit", { uid: p.uid });
        msg = res.ok ? `${GRN}✓ ${p.species}을(를) 보관함으로 이동했습니다.${R}` : `${RED}✗ ${res.data.error}${R}`;
      } else {
        const p = storage[si];
        if (!p) continue;
        const res = await apiPost("/api/game/storage/withdraw", { uid: p.uid });
        msg = res.ok ? `${GRN}✓ ${p.species}을(를) 파티로 이동했습니다.${R}` : `${RED}✗ ${res.data.error}${R}`;
      }
      const fresh = await fetchData();
      if (fresh) data = fresh;
      lastSpecies = null; // 아트 재로드 트리거
      first = true;
    }
  }

  process.stdout.write("\x1b[?25h");
}

export async function withdrawCommand(uid: string) {
  const res = await apiPost("/api/game/storage/withdraw", { uid });
  if (res.ok) console.log("보관함에서 파티로 이동했습니다!");
  else console.error(`오류: ${res.data.error}`);
}

export async function depositCommand(uid: string) {
  const res = await apiPost("/api/game/storage/deposit", { uid });
  if (res.ok) console.log("파티에서 보관함으로 이동했습니다!");
  else console.error(`오류: ${res.data.error}`);
}
