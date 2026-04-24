/**
 * Pure visual helpers for the wild-encounter battle CLI. Extracted from
 * `commands/encounter.ts` so that the command file can focus on state
 * transitions and network calls. Everything here is deterministic string
 * construction — no API calls, no `process.stdout.write` except where
 * explicitly passed through from `redraw`/`sleep` in the animation helper.
 */
import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "./colors.js";
import { renderHpBar, sideBySide, stripAnsi } from "./display.js";
import { redraw } from "./screen.js";
import { padRight, artToLines, mergeSideBySide } from "./text.js";

// ── stdin 유틸 ──────────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 레이아웃 유틸 ───────────────────────────────────────────────
export const LEFT_W = 46;
export const GAP = "    ";

// ── 아트 유틸 ───────────────────────────────────────────────────
export function tintArt(art: string, color: string): string {
  return art
    .split("\n")
    .map((l) => `${color}${l}\x1b[0m`)
    .join("\n");
}

export type PokemonInfo = { species: string; level: number; hp: number; maxHp: number };

export function buildBattleScene(
  myPoke: PokemonInfo,
  wild: PokemonInfo,
  myArt: string,
  rightArt: string,
): string {
  const myLabel   = `      ${myPoke.species} Lv.${myPoke.level}`;
  const myHp      = `  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp, 12)}`;
  const wildHp    = `  HP: ${renderHpBar(wild.hp, wild.maxHp, 12)}`;
  const shiftLeft = (s: string) => s.split("\n").map(l => "    " + l).join("\n");
  const indentArt = (s: string) => s.split("\n").map(l => "          " + l).join("\n");

  // HP바 색상 부분 시작 컬럼 = myHp 시각폭 + gap(6) + "  HP: "(6)
  const hpBarCol = stripAnsi(myHp).length + 6 + 6;
  // 이름 시작점을 HP바 색상과 동일하게: myLabel 시각폭 + gap(2) + prefix = hpBarCol
  const namePrefixLen = Math.max(0, hpBarCol - stripAnsi(myLabel).length - 2);
  const wildLabelStr  = " ".repeat(namePrefixLen) + `${wild.species} Lv.${wild.level}`;

  return [
    sideBySide(myLabel, wildLabelStr, 2),
    sideBySide(shiftLeft(myArt), indentArt(rightArt), 2),
    sideBySide(myHp, wildHp, 6),
  ].join("\n");
}

export function shiftArt(art: string, offset: number): string {
  return art.split("\n").map((l) => {
    if (offset > 0) return " ".repeat(offset) + l;
    const spaces = l.match(/^ */)?.[0].length ?? 0;
    return l.slice(Math.min(-offset, spaces));
  }).join("\n");
}

export async function playBallThrowAnimation(
  myPoke: PokemonInfo,
  wild: PokemonInfo,
  myArt: string,
  wildArt: string,
  ballArt: string,
  catchResultPromise: Promise<{ data: unknown; ok: boolean }>,
): Promise<{ data: unknown; ok: boolean }> {
  let lineCount = 0;
  let first = true;

  const padded = ballArt + "\n\n";

  const draw = (rightArt: string) => {
    const content = buildBattleScene(myPoke, wild, myArt, rightArt);
    const lines = content.split("\n");
    lineCount = redraw(lines, lineCount, first);
    first = false;
  };

  draw(padded);
  await sleep(350);

  for (let i = 0; i < 3; i++) {
    draw(shiftArt(padded, 2));
    await sleep(100);
    draw(shiftArt(padded, -2));
    await sleep(100);
    draw(padded);
    await sleep(200);
  }

  const result = await catchResultPromise;
  const r = result.data as { result?: string; battleOver?: boolean };

  if (r.result === "caught") {
    draw(tintArt(padded, "\x1b[32m"));
    await sleep(700);
  } else {
    draw(tintArt(padded, "\x1b[31m"));
    await sleep(250);
    draw(wildArt);
    await sleep(300);
  }

  return result;
}

// ── 아이템 메타 ─────────────────────────────────────────────────
export const BALL_KEYS = ["pokeball", "safariball", "greatball", "ultraball", "masterball"];
export const POTION_KEYS = ["potion", "superPotion", "hyperPotion"];

export const ITEM_DISPLAY: Record<string, string> = {
  pokeball:    "몬스터볼",
  safariball:  "사파리볼",
  greatball:   "슈퍼볼",
  ultraball:   "울트라볼",
  masterball:  "마스터볼",
  potion:      "상처약",
  superPotion: "좋은 상처약",
  hyperPotion: "굉장한 상처약",
};

export const BALL_ART_KEY: Record<string, string> = {
  pokeball:   "MonsterBall",
  safariball: "SafariBall",
  greatball:  "GreatBall",
  ultraball:  "UltraBall",
  masterball: "MasterBall",
};

export type Move = { id: string; name?: string; pp: number; maxPp: number };

export interface BattleResult {
  battleOver: boolean;
  result?: string;
  log?: string[];
  caught?: boolean;
  missed?: boolean;
  effectiveness?: number;
  message?: string;
  rewards?: { exp: number; points: number };
  [key: string]: unknown;
}

export type PartyMon = { uid: string; species: string; level: number; hp: number; maxHp: number };

// ── Phase 1: 포켓몬 선택 ─────────────────────────────────────────
export function buildSelectLines(
  title: string,
  party: PartyMon[],
  cursor: number,
  art: string | null,
): string[] {
  const alive = party.filter(p => p.hp > 0);
  const left: string[] = [];
  for (let i = 0; i < alive.length; i++) {
    const p      = alive[i];
    const active = i === cursor;
    const cur    = active ? `${CYN}❯${R}` : " ";
    const name   = active ? `${BLD}${p.species}${R}` : p.species;
    const level  = `${DIM}Lv.${p.level}${R}`;
    const ratio  = p.hp / p.maxHp;
    const hpCol  = ratio <= 0.25 ? RED : ratio <= 0.5 ? YEL : GRN;
    const filled = Math.round(ratio * 10);
    const bar    = `${hpCol}${"█".repeat(filled)}${"░".repeat(10 - filled)}${R}`;
    const hpNum  = `${DIM}${p.hp}/${p.maxHp}${R}`;
    left.push(`${cur} ${padRight(name, 14)} ${padRight(level, 7)} ${bar} ${hpNum}`);
  }

  const right = artToLines(art);

  const lines: string[] = [
    "",
    `  ${DIM}${title}${R}`,
    "",
    `  ${BLD}── 출전 포켓몬 선택 ──${R}`,
    "  " + "─".repeat(50),
    `  ${DIM}↑↓ 탐색   Enter 출전   Esc 뒤로${R}`,
    "",
    ...mergeSideBySide(left, right),
    "",
  ];
  return lines;
}

// ── 배틀 패널 빌더 ──────────────────────────────────────────────
export type SubMode = "menu" | "fight" | "bag" | "party";

export const MENU_ACTIONS = ["싸운다", "가방", "포켓몬", "도망치기"];

export function buildMenuPanel(menuCursor: number): string[] {
  const items = MENU_ACTIONS.map((a, i) =>
    i === menuCursor ? `${CYN}[ ${BLD}${a}${R}${CYN} ]${R}` : `${DIM}[ ${a} ]${R}`
  );
  return [
    `  ${items[0]}   ${items[1]}`,
    `  ${items[2]}   ${items[3]}`,
    "",
    `  ${DIM}↑↓←→ 선택   Enter 결정${R}`,
  ];
}

export function buildFightPanel(moves: Move[], fightCursor: number): string[] {
  // 2x2 그리드
  const lines: string[] = [];
  const row0: string[] = [];
  const row1: string[] = [];

  for (let i = 0; i < 4; i++) {
    const m      = moves[i];
    const active = i === fightCursor;
    if (!m) {
      const cell = `${DIM}[ ──────────────── ]${R}`;
      if (i < 2) row0.push(cell); else row1.push(cell);
      continue;
    }
    const pp      = m.pp;
    const maxPp   = m.maxPp;
    const ratio   = maxPp > 0 ? pp / maxPp : 1;
    const ppColor = pp === 0 ? RED : ratio <= 0.25 ? YEL : DIM;
    const ppStr   = `${ppColor}PP ${pp}/${maxPp}${R}`;
    const moveName = m.name ?? m.id;
    const inner   = active
      ? `${CYN}${BLD}${padRight(moveName, 12)}${R} ${ppStr}`
      : `${DIM}${padRight(moveName, 12)}${R} ${ppStr}`;
    const cell    = active
      ? `${CYN}[${R} ${inner} ${CYN}]${R}`
      : `${DIM}[${R} ${inner} ${DIM}]${R}`;
    if (i < 2) row0.push(cell); else row1.push(cell);
  }

  lines.push(`  ${row0.join("   ")}`);
  lines.push(`  ${row1.join("   ")}`);
  lines.push("");
  lines.push(`  ${DIM}↑↓←→ 선택   Enter 사용   Esc 뒤로${R}`);
  return lines;
}

export const BAG_CATEGORIES = [
  { label: "몬스터볼", keys: BALL_KEYS },
  { label: "상처약",   keys: POTION_KEYS },
];

export function buildBagPanel(
  bagCat: number,
  bagCursor: number,
  inventory: Record<string, number>,
  visibleItems: [string, number][],
): string[] {
  // 카테고리 탭
  const catLabel = BAG_CATEGORIES.map((c, i) =>
    i === bagCat ? `${CYN}${BLD}${c.label}${R}` : `${DIM}${c.label}${R}`
  ).join(`  ${DIM}·${R}  `);

  const lines: string[] = [];
  lines.push(`  ← ${catLabel}  →`);

  // 아이템 목록 (최대 4줄, 빈 줄로 패딩)
  const MAX_VISIBLE = 4;
  for (let i = 0; i < MAX_VISIBLE; i++) {
    const item = visibleItems[i];
    if (!item) {
      lines.push("");
      continue;
    }
    const [key, count] = item;
    const active = i === bagCursor;
    const cur    = active ? `${CYN}❯${R}` : " ";
    const name   = active ? `${BLD}${ITEM_DISPLAY[key] ?? key}${R}` : `${DIM}${ITEM_DISPLAY[key] ?? key}${R}`;
    lines.push(`  ${cur} ${padRight(name, 16)} ${DIM}×${count}${R}`);
  }

  lines.push("");
  lines.push(`  ${DIM}←→ 카테고리   ↑↓ 아이템   Enter 사용/던지기   Esc 뒤로${R}`);
  return lines;
}

export function buildPartyPanel(
  party: PartyMon[],
  partyCursor: number,
  currentUid: string,
  art: string | null,
  partyForced: boolean,
): string[] {
  const left: string[] = [];
  for (let i = 0; i < party.length; i++) {
    const p       = party[i];
    const isActive = p.uid === currentUid;
    const fainted  = p.hp <= 0;
    const active   = i === partyCursor;

    const cur = active ? `${CYN}❯${R}` : " ";
    let name: string;

    if (isActive) {
      name = active ? `${YEL}${BLD}${p.species}${R}` : `${YEL}${p.species}${R}`;
    } else if (fainted) {
      name = `${DIM}${p.species}${R}`;
    } else {
      name = active ? `${BLD}${p.species}${R}` : p.species;
    }

    const level = `${DIM}Lv.${p.level}${R}`;
    const ratio  = p.maxHp > 0 ? p.hp / p.maxHp : 0;
    const hpCol  = fainted ? DIM : ratio <= 0.25 ? RED : ratio <= 0.5 ? YEL : GRN;
    const filled = Math.round(ratio * 10);
    const bar    = fainted
      ? `${DIM}${"░".repeat(10)}${R}`
      : `${hpCol}${"█".repeat(filled)}${"░".repeat(10 - filled)}${R}`;

    left.push(`${cur} ${padRight(name, 14)} ${padRight(level, 7)} ${bar}`);
  }

  const right = artToLines(art);

  const escHint = partyForced
    ? `${DIM}↑↓ 탐색   Enter 교체${R}`
    : `${DIM}↑↓ 탐색   Enter 교체   Esc 취소${R}`;

  const lines: string[] = [
    "",
    `  ${BLD}포켓몬 교체${R}`,
    "  " + "─".repeat(50),
    `  ${escHint}`,
    "",
    ...mergeSideBySide(left, right),
    "",
  ];
  return lines;
}
