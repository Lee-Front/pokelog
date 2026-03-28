import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "../ui/colors.js";
import { apiPost, apiGet } from "../api-client.js";
import { fetchArt, fetchBallArt, renderHpBar, sideBySide, stripAnsi, redraw } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";

// ── stdin 유틸 ──────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

const LEFT_W = 46;
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

// ── 아트 유틸 ───────────────────────────────────────────────────
function tintArt(art: string, color: string): string {
  return art
    .split("\n")
    .map((l) => `${color}${l}\x1b[0m`)
    .join("\n");
}

type PokemonInfo = { species: string; level: number; hp: number; maxHp: number };

function buildBattleScene(
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

function shiftArt(art: string, offset: number): string {
  return art.split("\n").map((l) => {
    if (offset > 0) return " ".repeat(offset) + l;
    const spaces = l.match(/^ */)?.[0].length ?? 0;
    return l.slice(Math.min(-offset, spaces));
  }).join("\n");
}

async function playBallThrowAnimation(
  myPoke: PokemonInfo,
  wild: PokemonInfo,
  myArt: string,
  wildArt: string,
  ballArt: string,
  catchResultPromise: Promise<{ data: unknown; ok: boolean }>,
): Promise<{ data: unknown; ok: boolean }> {
  let lineCount = 0;

  const padded = ballArt + "\n\n";

  const draw = (rightArt: string) => {
    const content = buildBattleScene(myPoke, wild, myArt, rightArt);
    const lines = content.split("\n");
    let out = "\x1b[?25l";
    if (lineCount > 0) {
      out += `\x1b[${lineCount}A`;
      out += lines.map(l => "\r" + l + "\x1b[0m\x1b[K").join("\n") + "\n";
    } else {
      out += "\x1b[2J\x1b[H";
      out += content + "\n";
    }
    out += "\x1b[?25h";
    process.stdout.write(out);
    lineCount = lines.length;
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
const BALL_KEYS = ["pokeball", "safariball", "greatball", "ultraball", "masterball"];
const POTION_KEYS = ["potion", "superPotion", "hyperPotion"];

const ITEM_DISPLAY: Record<string, string> = {
  pokeball:    "몬스터볼",
  safariball:  "사파리볼",
  greatball:   "슈퍼볼",
  ultraball:   "울트라볼",
  masterball:  "마스터볼",
  potion:      "상처약",
  superPotion: "좋은 상처약",
  hyperPotion: "굉장한 상처약",
};

const BALL_ART_KEY: Record<string, string> = {
  pokeball:   "MonsterBall",
  safariball: "SafariBall",
  greatball:  "GreatBall",
  ultraball:  "UltraBall",
  masterball: "MasterBall",
};

type Move = { id: string; name?: string; pp: number; maxPp: number };

interface BattleResult {
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

type PartyMon = { uid: string; species: string; level: number; hp: number; maxHp: number };

// ── Phase 1: 포켓몬 선택 ─────────────────────────────────────────
function buildSelectLines(
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
    "",
    ...mergeSideBySide(left, right),
    "",
    `  ${DIM}↑↓ 탐색   Enter 출전   Esc 뒤로${R}`,
  ];
  return lines;
}

// ── 배틀 패널 빌더 ──────────────────────────────────────────────
type SubMode = "menu" | "fight" | "bag" | "party";

const MENU_ACTIONS = ["싸운다", "가방", "포켓몬", "도망치기"];

function buildMenuPanel(menuCursor: number): string[] {
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

function buildFightPanel(moves: Move[], fightCursor: number): string[] {
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

const BAG_CATEGORIES = [
  { label: "몬스터볼", keys: BALL_KEYS },
  { label: "상처약",   keys: POTION_KEYS },
];

function buildBagPanel(
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

function buildPartyPanel(
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

// ── 메인 ───────────────────────────────────────────────────────
export async function encounterCommand(
  eventId: string,
  wildInfo: { species: string; level: number },
): Promise<void> {
  enterRaw();

  // 파티 로드
  const partyRes = await apiGet("/api/game/party");
  if (!partyRes.ok) {
    process.stdout.write(`\n  ${RED}오류: ${partyRes.data.error}${R}\n`);
    return;
  }

  const party = partyRes.data.party as PartyMon[];
  const alivePokemon = party.filter(p => p.hp > 0);
  if (alivePokemon.length === 0) {
    const errLines = [
      "",
      `  ${RED}전투 가능한 포켓몬이 없습니다.${R}`,
      `  ${DIM}포켓몬이 모두 쓰러져 있습니다. 인벤토리에서 회복 아이템을 사용하세요.${R}`,
      "",
      `  ${DIM}Enter / Esc 뒤로${R}`,
    ];
    redraw(errLines, 0, true);
    await waitKey();
    return;
  }

  // ── Phase 1: 포켓몬 선택 ─────────────────────────────────────
  const artCache = new Map<string, string | null>();

  async function getCachedArt(species: string): Promise<string | null> {
    if (!artCache.has(species)) {
      const art = await fetchArt(species);
      artCache.set(species, art);
    }
    return artCache.get(species) ?? null;
  }

  let selectCursor = 0;
  let selectLineCount = 0;
  let selectFirst = true;
  let selectArt: string | null = null;
  let lastSelectSpecies = "";
  const titleStr = `야생 ${wildInfo.species} Lv.${wildInfo.level}`;

  let selectedUid: string | null = null;

  while (selectedUid === null) {
    const alive = party.filter(p => p.hp > 0);
    selectCursor = Math.min(selectCursor, Math.max(0, alive.length - 1));

    const species = alive[selectCursor]?.species ?? "";
    if (species !== lastSelectSpecies) {
      selectArt = species ? await getCachedArt(species) : null;
      lastSelectSpecies = species;
    }

    const lines = buildSelectLines(titleStr, party, selectCursor, selectArt);
    selectLineCount = redraw(lines, selectLineCount, selectFirst);
    selectFirst = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") {
      process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
      return;
    }
    else if (key === "\x1b[A") { if (selectCursor > 0) selectCursor--; }
    else if (key === "\x1b[B") { if (selectCursor < alive.length - 1) selectCursor++; }
    else if (key === "\r") {
      const chosen = alive[selectCursor];
      if (chosen) selectedUid = chosen.uid;
    }
  }

  // 배틀 시작
  const startRes = await apiPost("/api/battle/start", { eventId, pokemonUid: selectedUid });
  if (!startRes.ok) {
    const errLines = [
      "",
      `  ${RED}전투 시작 오류: ${startRes.data.error}${R}`,
      "",
      `  ${DIM}Enter / Esc 뒤로${R}`,
    ];
    redraw(errLines, 0, true);
    await waitKey();
    return;
  }

  // ── Phase 2: 배틀 루프 ───────────────────────────────────────
  let battleOver = false;
  const battleLog: string[] = [];

  type SubMode = "menu" | "fight" | "bag" | "party";
  let subMode: SubMode = "menu";

  let menuCursor  = 0;
  let fightCursor = 0;
  let bagCat      = 0;
  let bagCursor   = 0;
  let partyCursor = 0;
  let partyForced = false;

  let stateStale  = true;
  let first       = true;
  let lineCount   = 0;

  // 현재 배틀 상태
  let wildState: PokemonInfo = { species: wildInfo.species, level: wildInfo.level, hp: 1, maxHp: 1 };
  let myPoke: PartyMon | null = null;
  let myPokeMoves: Move[] = [];
  let inventory: Record<string, number> = {};

  let wildArt: string | null = null;
  let myArt: string | null = null;
  let partyArt: string | null = null;
  let lastPartyArtUid = "";

  // scene lines (battle art + log)
  let sceneLines: string[] = [];

  function buildSceneLines(): string[] {
    const lines: string[] = [];
    if (myPoke && wildArt && myArt) {
      const scene = buildBattleScene(myPoke, wildState, myArt, wildArt);
      for (const l of scene.split("\n")) lines.push(l);
    } else {
      lines.push(`  ${wildState.species} Lv.${wildState.level}`);
      lines.push(`  HP: ${renderHpBar(wildState.hp, wildState.maxHp, 12)}`);
      if (myPoke) {
        lines.push(`  ${myPoke.species} Lv.${myPoke.level}`);
        lines.push(`  HP: ${renderHpBar(myPoke.hp, myPoke.maxHp, 12)}`);
      }
    }
    lines.push("");
    lines.push(`  ${DIM}${"─".repeat(48)}${R}`);
    // 항상 3줄 고정 → 라인 수 변화 없이 line-by-line overwrite 유지
    const recent = battleLog.slice(-3);
    const logLines = recent.length === 0
      ? [`  ${DIM}전투 시작!${R}`, "", ""]
      : [
          recent[0] ? `  ${recent[0]}` : "",
          recent[1] ? `  ${recent[1]}` : "",
          recent[2] ? `  ${recent[2]}` : "",
        ];
    for (const l of logLines) lines.push(l);
    lines.push(`  ${DIM}${"─".repeat(48)}${R}`);
    lines.push("");
    return lines;
  }

  function buildFullLines(): string[] {
    const scene = buildSceneLines();
    let panel: string[];

    if (subMode === "menu") {
      panel = buildMenuPanel(menuCursor);
    } else if (subMode === "fight") {
      panel = buildFightPanel(myPokeMoves, fightCursor);
    } else if (subMode === "bag") {
      const catKeys = BAG_CATEGORIES[bagCat].keys;
      const visibleItems: [string, number][] = catKeys
        .filter(k => (inventory[k] ?? 0) > 0)
        .map(k => [k, inventory[k]] as [string, number]);
      panel = buildBagPanel(bagCat, bagCursor, inventory, visibleItems);
    } else {
      // party mode — use separate full-screen layout
      panel = buildPartyPanel(party, partyCursor, myPoke?.uid ?? "", partyArt, partyForced);
    }

    if (subMode === "party") {
      // Party mode: replace scene entirely
      return panel;
    }

    return [...scene, ...panel];
  }

  while (!battleOver) {
    // 상태 갱신
    if (stateStale) {
      const stateRes = await apiGet("/api/battle/state");
      if (!stateRes.ok || !stateRes.data.battleState) break;

      const state = stateRes.data.battleState as {
        wild: { species: string; level: number; hp: number; maxHp: number };
        myPokemonUid: string;
      };

      wildState = state.wild;
      myPoke    = party.find(p => p.uid === state.myPokemonUid) ?? null;

      // 아트 fetch
      if (!artCache.has(wildState.species)) {
        const art = await fetchArt(wildState.species);
        artCache.set(wildState.species, art);
      }
      wildArt = artCache.get(wildState.species) ?? null;

      if (myPoke) {
        if (!artCache.has(myPoke.species)) {
          const art = await fetchArt(myPoke.species);
          artCache.set(myPoke.species, art);
        }
        myArt = artCache.get(myPoke.species) ?? null;
      }

      // 기술 목록 fetch
      if (myPoke) {
        const detailRes = await apiGet(`/api/game/pokemon/${myPoke.uid}`);
        if (detailRes.ok) {
          myPokeMoves = (detailRes.data.pokemon as { moves?: Move[] })?.moves ?? [];
        }
      }

      // 인벤토리 fetch
      const invRes = await apiGet("/api/game/inventory");
      if (invRes.ok) inventory = invRes.data.inventory as Record<string, number>;

      stateStale = false;

      // 현재 포켓몬이 쓰러진 경우 강제 교체
      if (myPoke && myPoke.hp <= 0) {
        const alive = party.filter(p => p.hp > 0);
        if (alive.length === 0) {
          battleOver = true;
          battleLog.push(`${RED}전투 패배...${R}`);
          first = true;
          break;
        }
        subMode     = "party";
        partyForced = true;
        partyCursor = party.findIndex(p => p.hp > 0);
        if (partyCursor < 0) partyCursor = 0;
        first = true;
      }
    }

    // 파티 모드일 때 아트 fetch
    if (subMode === "party") {
      const targetUid = party[partyCursor]?.uid ?? "";
      if (targetUid !== lastPartyArtUid) {
        const sp = party[partyCursor]?.species ?? "";
        partyArt = sp ? await getCachedArt(sp) : null;
        lastPartyArtUid = targetUid;
      }
    }

    const lines = buildFullLines();
    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }

    // ── 메뉴 모드 ──────────────────────────────────────────────
    if (subMode === "menu") {
      if (key === "\x1b[D") { if (menuCursor % 2 > 0) menuCursor--; }
      else if (key === "\x1b[C") { if (menuCursor % 2 < 1) menuCursor++; }
      else if (key === "\x1b[A") { if (menuCursor >= 2) menuCursor -= 2; }
      else if (key === "\x1b[B") { if (menuCursor < 2) menuCursor += 2; }
      else if (key === "\r") {
        const action = MENU_ACTIONS[menuCursor];
        if (action === "싸운다") {
          subMode = "fight";
          fightCursor = 0;
        } else if (action === "가방") {
          subMode = "bag";
          bagCat = 0;
          bagCursor = 0;
        } else if (action === "포켓몬") {
          subMode = "party";
          partyForced = false;
          partyCursor = 0;
          lastPartyArtUid = "";
          partyArt = null;
          first = true;
        } else if (action === "도망치기") {
          const runRes = await apiPost("/api/battle/action", { action: "run", data: {} });
          const r = runRes.data as BattleResult;
          if (r.message) battleLog.push(r.message);
          if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
          if (r.battleOver) {
            battleOver = true;
            battleLog.push("도망쳤다!");
          }
          // 파티 HP 갱신
          const pr = await apiGet("/api/game/party");
          if (pr.ok) {
            const np = pr.data.party as PartyMon[];
            for (const p of party) {
              const u = np.find(n => n.uid === p.uid);
              if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
            }
          }
          stateStale = true;
          subMode    = "menu";
        }
      }
    }

    // ── 싸운다 모드 ────────────────────────────────────────────
    else if (subMode === "fight") {
      const rowSize = 2;
      const row = Math.floor(fightCursor / rowSize);
      const col = fightCursor % rowSize;
      const moveCount = myPokeMoves.length;

      if (key === "\x1b" || key === "q") { subMode = "menu"; }
      else if (key === "\x1b[A") {
        const newRow = row - 1;
        if (newRow >= 0) fightCursor = newRow * rowSize + col;
      }
      else if (key === "\x1b[B") {
        const newRow = row + 1;
        const newIdx = newRow * rowSize + col;
        if (newIdx < moveCount) fightCursor = newIdx;
      }
      else if (key === "\x1b[D") {
        if (col > 0) fightCursor--;
      }
      else if (key === "\x1b[C") {
        if (col < rowSize - 1 && fightCursor + 1 < moveCount) fightCursor++;
      }
      else if (key === "\r") {
        const move = myPokeMoves[fightCursor];
        if (!move) continue;
        if (move.pp <= 0) continue;

        const res = await apiPost("/api/battle/action", { action: "fight", data: { moveId: move.id } });
        const r   = res.data as BattleResult;
        if (r.message) battleLog.push(r.message);
        if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
        if (r.battleOver) {
          battleOver = true;
          if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
          else if (r.result === "defeat") battleLog.push(`${RED}전투 패배...${R}`);
        }
        if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

        const pr = await apiGet("/api/game/party");
        if (pr.ok) {
          const np = pr.data.party as PartyMon[];
          for (const p of party) {
            const u = np.find(n => n.uid === p.uid);
            if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
          }
        }
        stateStale = true;
        subMode    = "menu";
      }
    }

    // ── 가방 모드 ──────────────────────────────────────────────
    else if (subMode === "bag") {
      const catKeys = BAG_CATEGORIES[bagCat].keys;
      const visibleItems: [string, number][] = catKeys
        .filter(k => (inventory[k] ?? 0) > 0)
        .map(k => [k, inventory[k]] as [string, number]);

      if (key === "\x1b" || key === "q") { subMode = "menu"; }
      else if (key === "\x1b[D") {
        bagCat    = (bagCat - 1 + BAG_CATEGORIES.length) % BAG_CATEGORIES.length;
        bagCursor = 0;
      }
      else if (key === "\x1b[C") {
        bagCat    = (bagCat + 1) % BAG_CATEGORIES.length;
        bagCursor = 0;
      }
      else if (key === "\x1b[A") {
        if (bagCursor > 0) bagCursor--;
      }
      else if (key === "\x1b[B") {
        if (bagCursor < visibleItems.length - 1) bagCursor++;
      }
      else if (key === "\r") {
        const item = visibleItems[bagCursor];
        if (!item) continue;
        const [itemKey] = item;

        if (BALL_KEYS.includes(itemKey)) {
          // 볼 던지기
          const catchPromise = apiPost("/api/battle/action", { action: "catch", data: { ball: itemKey } });

          if (myPoke && myArt && wildArt) {
            const ballArtStr = await fetchBallArt(BALL_ART_KEY[itemKey] ?? itemKey);
            if (ballArtStr) {
              await playBallThrowAnimation(myPoke, wildState, myArt, wildArt, ballArtStr, catchPromise);
            }
          }

          const catchResult = await catchPromise;
          const r = catchResult.data as BattleResult;
          if (r.message) battleLog.push(r.message);
          if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
          if (r.caught) battleLog.push(`${YEL}포획 성공!${R}`);
          if (r.battleOver) {
            battleOver = true;
            if (r.result === "caught") battleLog.push(`${YEL}포켓몬을 잡았다!${R}`);
            else if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
            else if (r.result === "defeat")  battleLog.push(`${RED}전투 패배...${R}`);
          }
          if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

          const pr = await apiGet("/api/game/party");
          if (pr.ok) {
            const np = pr.data.party as PartyMon[];
            for (const p of party) {
              const u = np.find(n => n.uid === p.uid);
              if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
            }
          }
          inventory[itemKey] = Math.max(0, (inventory[itemKey] ?? 1) - 1);
          stateStale = true;
          subMode    = "menu";
        } else {
          // 포션 사용
          if (!myPoke) continue;
          const res = await apiPost("/api/battle/action", {
            action: "item",
            data: { item: itemKey, pokemonUid: myPoke.uid },
          });
          const r = res.data as BattleResult;
          if (r.message) battleLog.push(r.message);
          if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
          if (r.battleOver) {
            battleOver = true;
            if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
            else if (r.result === "defeat") battleLog.push(`${RED}전투 패배...${R}`);
          }
          if (r.rewards) battleLog.push(`보상: EXP +${r.rewards.exp}, ${r.rewards.points}P`);

          const pr = await apiGet("/api/game/party");
          if (pr.ok) {
            const np = pr.data.party as PartyMon[];
            for (const p of party) {
              const u = np.find(n => n.uid === p.uid);
              if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
            }
          }
          inventory[itemKey] = Math.max(0, (inventory[itemKey] ?? 1) - 1);
          stateStale = true;
          subMode    = "menu";
        }
      }
    }

    // ── 파티 모드 ──────────────────────────────────────────────
    else if (subMode === "party") {
      if (key === "\x1b[A") {
        if (partyCursor > 0) {
          partyCursor--;
          lastPartyArtUid = "";
        }
      }
      else if (key === "\x1b[B") {
        if (partyCursor < party.length - 1) {
          partyCursor++;
          lastPartyArtUid = "";
        }
      }
      else if (key === "\x1b" || key === "q") {
        if (!partyForced) {
          subMode = "menu";
          first   = true;
          lastPartyArtUid = "";
          partyArt = null;
        }
        // partyForced 시 Esc 무시
      }
      else if (key === "\r") {
        const target = party[partyCursor];
        if (!target) continue;
        if (target.uid === myPoke?.uid) continue; // 이미 출전 중
        if (target.hp <= 0) continue; // 쓰러진 포켓몬

        const forced = partyForced;
        const res = await apiPost("/api/battle/action", {
          action: "switch",
          data: { pokemonUid: target.uid, forced },
        });
        const r = res.data as BattleResult;
        if (r.message) battleLog.push(r.message);
        if (Array.isArray(r.log)) for (const m of r.log as string[]) battleLog.push(m);
        if (r.battleOver) {
          battleOver = true;
          if (r.result === "victory") battleLog.push(`${GRN}전투 승리!${R}`);
          else if (r.result === "defeat") battleLog.push(`${RED}전투 패배...${R}`);
        }

        const pr = await apiGet("/api/game/party");
        if (pr.ok) {
          const np = pr.data.party as PartyMon[];
          for (const p of party) {
            const u = np.find(n => n.uid === p.uid);
            if (u) { p.hp = u.hp; p.maxHp = u.maxHp; }
          }
        }
        partyForced     = false;
        stateStale      = true;
        subMode         = "menu";
        lastPartyArtUid = "";
        partyArt        = null;
        first           = true;
      }
    }
  }

  // ── 전투 종료 화면 ───────────────────────────────────────────
  first = true;
  const finalScene = buildSceneLines();
  const finalLines = [
    ...finalScene,
    "",
    `  ${DIM}아무 키나 누르세요...${R}`,
  ];
  lineCount = redraw(finalLines, lineCount, first);
  await waitKey();
  process.stdout.write("\x1b[?25h\x1b[2J\x1b[H");
}
