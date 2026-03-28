import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchArt, redraw } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { visualWidth, padRight, artToLines, stripAnsi } from "../ui/text.js";

type PokemonEntry = { uid: string; species: string; level: number; hp: number; maxHp: number };

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
const PARTY_W        = 22;
const STORAGE_W      = 22;
const GAP            = "   ";
const STORAGE_VISIBLE = 6; // 보관함 한 번에 표시할 줄 수 (파티와 동일)

function buildLines(
  party: PokemonEntry[],
  storage: PokemonEntry[],
  panel: "party" | "storage",
  pi: number,
  si: number,
  scroll: number,
  art: string | null,
  msg: string,
): string[] {
  // 파티 열 (6줄 고정)
  const partyLines: string[] = [];
  const partyHdr = panel === "party"
    ? `${CYN}${BLD}── 파티 (${party.length}/6) ──${R}`
    : `${YEL}── 파티 (${party.length}/6) ──${R}`;
  partyLines.push(partyHdr);
  for (let i = 0; i < 6; i++) {
    const p = party[i];
    const active = panel === "party" && i === pi;
    const cur = active ? `${CYN}❯${R}` : " ";
    if (p) {
      const name = active ? `${BLD}${p.species}${R}` : p.species;
      partyLines.push(`${cur} ${padRight(name, 13)} ${DIM}Lv.${p.level}${R}`);
    } else {
      partyLines.push(`${cur} ${DIM}(빈 슬롯)${R}`);
    }
  }

  // 보관함 열 (STORAGE_VISIBLE줄 고정, 스크롤)
  const storageLines: string[] = [];
  const storEnd   = Math.min(scroll + STORAGE_VISIBLE, storage.length);
  const hdrLabel  = storage.length === 0
    ? `보관함 (비어있음)`
    : storage.length <= STORAGE_VISIBLE
    ? `보관함 (${storage.length}마리)`
    : `보관함 ${scroll + 1}-${storEnd}/${storage.length}`;
  const storHdr = panel === "storage"
    ? `${CYN}${BLD}── ${hdrLabel} ──${R}`
    : `${DIM}── ${hdrLabel} ──${R}`;
  storageLines.push(storHdr);

  if (storage.length === 0) {
    storageLines.push(`  ${DIM}비어 있습니다.${R}`);
    for (let i = 1; i < STORAGE_VISIBLE; i++) storageLines.push("");
  } else {
    for (let i = 0; i < STORAGE_VISIBLE; i++) {
      const absIdx = scroll + i;
      if (absIdx >= storage.length) { storageLines.push(""); continue; }
      const p      = storage[absIdx];
      const active = panel === "storage" && absIdx === si;
      const cur    = active ? `${CYN}❯${R}` : " ";
      const name   = active ? `${BLD}${p.species}${R}` : p.species;
      storageLines.push(`${cur} ${padRight(name, 13)} ${DIM}Lv.${p.level}${R}`);
    }
    // 스크롤 인디케이터 (헤더에 범위 표시됨, 추가 힌트)
    if (scroll > 0 && storEnd < storage.length) {
      storageLines.push(`  ${DIM}▲▼ 스크롤${R}`);
    } else if (scroll > 0) {
      storageLines.push(`  ${DIM}▲ 위에 더 있음${R}`);
    } else if (storEnd < storage.length) {
      storageLines.push(`  ${DIM}▼ 아래 더 있음${R}`);
    }
  }

  // 이미지 열
  const artLines = artToLines(art);

  // 3열 병합
  const rows = Math.max(partyLines.length, storageLines.length, artLines.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padRight(partyLines[i]   ?? "", PARTY_W);
    const m = padRight(storageLines[i] ?? "", STORAGE_W);
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
  let pi     = 0;
  let si     = 0;
  let scroll = 0; // 보관함 스크롤 오프셋
  let msg    = "";
  let lineCount = 0;
  let first  = true;
  let currentArt: string | null = null;
  let lastSpecies: string | null = null;

  let data = await fetchData();
  if (!data) { process.stdout.write("  오류: 데이터를 불러올 수 없습니다.\n"); return; }

  while (true) {
    const { party, storage } = data;

    // 커서 범위 보정
    pi = Math.min(pi, 5);
    si = Math.min(si, Math.max(0, storage.length - 1));
    scroll = Math.max(0, Math.min(scroll, Math.max(0, storage.length - STORAGE_VISIBLE)));

    // 선택된 포켓몬 아트 fetch (캐시 활용)
    const species = getSelectedSpecies(party, storage, panel, pi, si);
    if (species && species !== lastSpecies) {
      currentArt = await getCachedArt(species);
      lastSpecies = species;
    } else if (!species) {
      currentArt = null;
      lastSpecies = null;
    }

    const lines = buildLines(party, storage, panel, pi, si, scroll, currentArt, msg);
    lineCount = redraw(lines, lineCount, first);
    first = false;
    msg = "";

    const key = await waitKey();

    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") break;

    else if (key === "\x1b[A") {
      if (panel === "party" && pi > 0) {
        pi--;
      } else if (panel === "storage" && si > 0) {
        si--;
        if (si < scroll) scroll = si;
      }
    }
    else if (key === "\x1b[B") {
      if (panel === "party" && pi < 5) {
        pi++;
      } else if (panel === "storage" && si < storage.length - 1) {
        si++;
        if (si >= scroll + STORAGE_VISIBLE) scroll = si - STORAGE_VISIBLE + 1;
      }
    }
    else if (key === "\x1b[D") {
      if (panel === "storage") {
        panel = "party";
        // 시각적 같은 행으로 이동 (scroll 유지)
        const visualRow = si - scroll;
        pi = Math.min(visualRow, 5);
      }
    }
    else if (key === "\x1b[C") {
      if (panel === "party" && storage.length > 0) {
        panel = "storage";
        // 파티 커서와 같은 시각 행으로 이동
        si = Math.min(scroll + pi, storage.length - 1);
      }
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
