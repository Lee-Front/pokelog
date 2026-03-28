import { DIM, RED, GRN, YEL, BLU, CYN, BLD, R } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchArt, fetchBallArt, renderHpBar, stripAnsi, redraw } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { visualWidth, padRight, artToLines, mergeSideBySide } from "../ui/text.js";

// ── 아이템 메타데이터 ───────────────────────────────────────────
const ITEM_META: Record<string, {
  name: string;
  type: "ball" | "potion";
  ballKey?: string;
  heal?: number;
  desc: string;
}> = {
  pokeball:    { name: "몬스터볼",       type: "ball",   ballKey: "MonsterBall", desc: "전투 전용 — 포획에 사용" },
  safariball:  { name: "사파리볼",       type: "ball",   ballKey: "SafariBall",  desc: "전투 전용 — 포획에 사용" },
  greatball:   { name: "슈퍼볼",         type: "ball",   ballKey: "GreatBall",   desc: "전투 전용 — 포획률 +50%" },
  ultraball:   { name: "울트라볼",       type: "ball",   ballKey: "UltraBall",   desc: "전투 전용 — 포획률 +100%" },
  masterball:  { name: "마스터볼",       type: "ball",   ballKey: "MasterBall",  desc: "전투 전용 — 확정 포획" },
  potion:      { name: "상처약",         type: "potion", heal: 20,               desc: "HP 20 회복" },
  superPotion: { name: "좋은 상처약",    type: "potion", heal: 50,               desc: "HP 50 회복" },
  hyperPotion: { name: "굉장한 상처약",  type: "potion", heal: 200,              desc: "HP 200 회복" },
};

function getItemName(key: string)  { return ITEM_META[key]?.name ?? key; }
function getItemDesc(key: string)  { return ITEM_META[key]?.desc ?? ""; }
function isUsable(key: string)     { return ITEM_META[key]?.type === "potion"; }

// ── 포션 아트 (텍스트) ──────────────────────────────────────────
function makePotionArt(heal: number): string {
  const hp = `+${heal} HP`;
  return [
    `${DIM}     .─.${R}`,
    `${DIM}    ( · )${R}`,
    `${DIM}  ┌──────┐${R}`,
    `${GRN}  │${BLD} ${hp.padStart(4).padEnd(5)} ${R}${GRN}│${R}`,
    `${DIM}  │      │${R}`,
    `${DIM}  └──────┘${R}`,
  ].join("\n");
}

// ── 레이아웃 유틸 ───────────────────────────────────────────────
const LEFT_W = 26;
const GAP    = "    ";

// ── 아트 캐시 ───────────────────────────────────────────────────
const artCache = new Map<string, string | null>();

async function getCachedArt(key: string, fetcher: () => Promise<string | null>): Promise<string | null> {
  if (artCache.has(key)) return artCache.get(key)!;
  const art = await fetcher();
  artCache.set(key, art);
  return art;
}

// ── 카테고리 ────────────────────────────────────────────────────
const CATEGORIES = [
  { label: "몬스터볼", keys: ["pokeball", "safariball", "greatball", "ultraball", "masterball"] },
  { label: "상처약",   keys: ["potion", "superPotion", "hyperPotion"] },
];

// ── Items 화면 ──────────────────────────────────────────────────
function buildItemsLines(
  catIdx: number,
  items: [string, number][],
  idx: number,
  art: string | null,
  msg: string,
): string[] {
  // 카테고리 탭
  const tabs = CATEGORIES.map((c, i) =>
    i === catIdx ? `${CYN}${BLD}${c.label}${R}` : `${DIM}${c.label}${R}`
  ).join(`  ${DIM}·${R}  `);

  // 왼쪽: 이름 + 개수
  const left: string[] = [];
  if (items.length === 0) {
    left.push(`  ${DIM}보유한 아이템이 없습니다.${R}`);
  } else {
    for (let i = 0; i < items.length; i++) {
      const [key, count] = items[i];
      const active = i === idx;
      const cursor = active ? `${CYN}❯${R}` : " ";
      const name   = active ? `${BLD}${getItemName(key)}${R}` : getItemName(key);
      left.push(`${cursor} ${padRight(name, 16)} ${DIM}×${count}${R}`);
    }
  }

  // 오른쪽: 아트
  const right = artToLines(art);

  // 선택 아이템 설명
  const selKey = items[idx]?.[0] ?? "";
  const desc   = selKey ? `${DIM}${getItemDesc(selKey)}${R}` : "";

  const lines: string[] = [
    "",
    `  ${BLD}인벤토리${R}`,
    "  " + "─".repeat(50),
    `  ${DIM}↑↓ 탐색   ←→ 카테고리   Enter 사용   Esc 뒤로${R}`,
    `  ← ${tabs}  →`,
    "",
    ...mergeSideBySide(left, right),
    "",
  ];
  if (desc) { lines.push(`  ${desc}`); lines.push(""); }
  if (msg)  { lines.push(`  ${msg}`); }
  return lines;
}

// ── Targets 화면 ───────────────────────────────────────────────
type PartyMon = { uid: string; species: string; level: number; hp: number; maxHp: number };

function buildTargetsLines(
  itemKey: string,
  itemCount: number,
  targets: PartyMon[],
  idx: number,
  art: string | null,
  msg: string,
): string[] {
  const left: string[] = [];
  left.push(`${YEL}── 파티 포켓몬 ──${R}`);
  for (let i = 0; i < targets.length; i++) {
    const p      = targets[i];
    const active = i === idx;
    const cursor = active ? `${CYN}❯${R}` : " ";
    const name   = active ? `${BLD}${p.species}${R}` : p.species;
    const ratio  = p.hp / p.maxHp;
    const hpCol  = ratio <= 0.25 ? RED : ratio <= 0.5 ? YEL : GRN;
    left.push(`${cursor} ${padRight(name, 14)} ${hpCol}${renderHpBar(p.hp, p.maxHp, 8)}${R}`);
  }

  const right = artToLines(art);

  const lines: string[] = [
    "",
    `  ${BLD}${getItemName(itemKey)}${R} ${DIM}사용 (×${itemCount} 보유)${R}`,
    "  " + "─".repeat(50),
    `  ${DIM}↑↓ 탐색   Enter 사용   Esc 뒤로${R}`,
    "",
    ...mergeSideBySide(left, right),
    "",
  ];
  if (msg) { lines.push(`  ${msg}`); }
  return lines;
}

// ── 메인 ───────────────────────────────────────────────────────
export async function inventoryCommand() {
  enterRaw();

  type Mode = "items" | "targets";
  let mode: Mode    = "items";
  let catIdx        = 0;
  let itemIdx       = 0;
  let targetIdx     = 0;
  let selectedItem  = "";
  let msg           = "";
  let lineCount     = 0;
  let first         = true;
  let currentArt: string | null = null;
  let lastArtKey    = "";

  // 인벤토리 & 파티 데이터
  let inv: Record<string, number> = {};
  let party: PartyMon[]           = [];
  let targets: PartyMon[]         = [];

  async function refreshInv() {
    const res = await apiGet("/api/game/inventory");
    if (res.ok) inv = res.data.inventory as Record<string, number>;
  }
  async function refreshParty() {
    const res = await apiGet("/api/game/party");
    if (res.ok) party = res.data.party as PartyMon[];
  }

  await Promise.all([refreshInv(), refreshParty()]);

  while (true) {
    // ── items 모드 ──
    if (mode === "items") {
      // 현재 카테고리 아이템만 필터
      const catKeys    = CATEGORIES[catIdx].keys;
      const catItems   = Object.entries(inv)
        .filter(([k, c]) => catKeys.includes(k) && c > 0) as [string, number][];

      itemIdx = Math.min(itemIdx, Math.max(0, catItems.length - 1));

      const artKey = catItems[itemIdx]?.[0] ?? "";
      if (artKey !== lastArtKey) {
        const meta = ITEM_META[artKey];
        if (meta?.type === "ball" && meta.ballKey) {
          currentArt = await getCachedArt(artKey, () => fetchBallArt(meta.ballKey!));
        } else if (meta?.type === "potion" && meta.heal !== undefined) {
          currentArt = makePotionArt(meta.heal);
          artCache.set(artKey, currentArt);
        } else {
          currentArt = null;
        }
        lastArtKey = artKey;
      }

      const lines = buildItemsLines(catIdx, catItems, itemIdx, currentArt, msg);
      lineCount = redraw(lines, lineCount, first);
      first = false;
      msg = "";

      const key = await waitKey();
      if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
      else if (key === "\x1b" || key === "q") break;
      else if (key === "\x1b[D") {
        catIdx = (catIdx - 1 + CATEGORIES.length) % CATEGORIES.length;
        itemIdx = 0; lastArtKey = ""; currentArt = null; first = true;
      }
      else if (key === "\x1b[C") {
        catIdx = (catIdx + 1) % CATEGORIES.length;
        itemIdx = 0; lastArtKey = ""; currentArt = null; first = true;
      }
      else if (key === "\x1b[A" && itemIdx > 0) { itemIdx--; }
      else if (key === "\x1b[B" && itemIdx < catItems.length - 1) { itemIdx++; }
      else if (key === "\r") {
        const [selKey] = catItems[itemIdx] ?? [];
        if (!selKey) continue;
        if (!isUsable(selKey)) {
          msg = `${DIM}몬스터볼은 전투 중에만 사용할 수 있습니다.${R}`;
          continue;
        }
        // 포션 → 타겟 선택 모드
        await refreshParty();
        targets = party.filter((p) => p.hp < p.maxHp);
        if (targets.length === 0) {
          msg = `${DIM}회복이 필요한 포켓몬이 없습니다.${R}`;
          continue;
        }
        selectedItem = selKey;
        targetIdx    = 0;
        lastArtKey   = "";
        currentArt   = null;
        mode         = "targets";
        first        = true;
      }
    }

    // ── targets 모드 ──
    else {
      targetIdx = Math.min(targetIdx, Math.max(0, targets.length - 1));

      const artKey = targets[targetIdx]?.species ?? "";
      if (artKey !== lastArtKey) {
        currentArt = await getCachedArt(artKey, () => fetchArt(artKey));
        lastArtKey = artKey;
      }

      const selCount = inv[selectedItem] ?? 0;
      const lines = buildTargetsLines(selectedItem, selCount, targets, targetIdx, currentArt, msg);
      lineCount = redraw(lines, lineCount, first);
      first = false;
      msg = "";

      const key = await waitKey();
      if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
      else if (key === "\x1b" || key === "q") {
        mode = "items"; lastArtKey = ""; currentArt = null; first = true;
      }
      else if (key === "\x1b[A" && targetIdx > 0) { targetIdx--; }
      else if (key === "\x1b[B" && targetIdx < targets.length - 1) { targetIdx++; }
      else if (key === "\r") {
        const target = targets[targetIdx];
        if (!target) continue;
        const res = await apiPost("/api/shop/use", { item: selectedItem, pokemonUid: target.uid });
        if (res.ok) {
          msg = `${GRN}✓ ${target.species}에게 ${getItemName(selectedItem)} 사용!${R}`;
          await Promise.all([refreshInv(), refreshParty()]);
          targets = party.filter((p) => p.hp < p.maxHp);
          if (targets.length === 0) {
            mode = "items"; lastArtKey = ""; currentArt = null; first = true;
          } else {
            targetIdx = Math.min(targetIdx, targets.length - 1);
          }
        } else {
          msg = `${RED}✗ ${res.data.error}${R}`;
        }
      }
    }
  }

  process.stdout.write("\x1b[?25h");
}
