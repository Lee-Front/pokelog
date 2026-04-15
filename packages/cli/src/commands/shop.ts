import { DIM, RED, GRN, YEL, CYN, BLD, R } from "../ui/colors.js";
import { apiGet, apiPost } from "../api-client.js";
import { fetchBallArt } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { padRight, artToLines, mergeSideBySide } from "../ui/text.js";
import { redraw } from "../ui/screen.js";

type ShopItem = {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
  guaranteedCatch?: boolean;
};

const CATEGORIES = [
  { label: "몬스터볼", keys: ["pokeball", "safariball", "greatball", "ultraball", "masterball"] },
  { label: "상처약",   keys: ["potion", "superPotion", "hyperPotion"] },
];

const BALL_KEYS = new Set(["pokeball", "safariball", "greatball", "ultraball", "masterball"]);
// ball key → art file name
const BALL_ART_KEY: Record<string, string> = {
  pokeball:   "MonsterBall",
  safariball: "SafariBall",
  greatball:  "GreatBall",
  ultraball:  "UltraBall",
  masterball: "MasterBall",
};

function rawNumberInput(label: string): Promise<number | null> {
  return new Promise((resolve) => {
    let buf = "";
    const paint = () => process.stdout.write(`\r  ${label} ${buf}\x1b[K`);
    process.stdout.write("\n");
    paint();
    const handler = (chunk: string) => {
      if (chunk === "\x03") { process.exit(0); }
      else if (chunk === "\x1b") { process.stdin.removeListener("data", handler); process.stdout.write("\n"); resolve(null); }
      else if (chunk === "\r")   { process.stdin.removeListener("data", handler); process.stdout.write("\n"); const n = parseInt(buf, 10); resolve(Number.isFinite(n) && n > 0 ? n : null); }
      else if ((chunk === "\x7f" || chunk === "\x08") && buf.length > 0) { buf = buf.slice(0, -1); paint(); }
      else if (/^\d$/.test(chunk) && buf.length < 5) { buf += chunk; paint(); }
    };
    process.stdin.on("data", handler);
  });
}

// ── 포션 아트 ───────────────────────────────────────────────────
function makePotionArt(healAmount: number): string {
  const hp = `+${healAmount} HP`;
  return [
    `${DIM}     .─.${R}`,
    `${DIM}    ( · )${R}`,
    `${DIM}  ┌──────┐${R}`,
    `${GRN}  │${BLD} ${hp.padStart(4).padEnd(5)} ${R}${GRN}│${R}`,
    `${DIM}  │      │${R}`,
    `${DIM}  └──────┘${R}`,
  ].join("\n");
}

// ── 아트 캐시 ───────────────────────────────────────────────────
const artCache = new Map<string, string | null>();

async function getArt(itemKey: string, item: ShopItem): Promise<string | null> {
  if (artCache.has(itemKey)) return artCache.get(itemKey)!;
  let art: string | null = null;
  if (BALL_KEYS.has(itemKey)) {
    art = await fetchBallArt(BALL_ART_KEY[itemKey] ?? itemKey);
  } else if (item.healAmount) {
    art = makePotionArt(item.healAmount);
  }
  artCache.set(itemKey, art);
  return art;
}

// ── 화면 그리기 ─────────────────────────────────────────────────
function buildLines(
  catIdx: number,
  itemIdx: number,
  catItems: { key: string; item: ShopItem }[],
  art: string | null,
  points: number,
  inventory: Record<string, number>,
  msg: string,
): string[] {
  // 카테고리 탭
  const tabs = CATEGORIES.map((c, i) => {
    if (i === catIdx) return `${CYN}${BLD}${c.label}${R}`;
    return `${DIM}${c.label}${R}`;
  }).join(`  ${DIM}·${R}  `);

  // 왼쪽: 이름 + 가격 + 보유 수량
  const left: string[] = [];
  for (let i = 0; i < catItems.length; i++) {
    const { key, item } = catItems[i];
    const active = i === itemIdx;
    const cursor = active ? `${CYN}❯${R}` : " ";
    const name   = active ? `${BLD}${item.name}${R}` : `${DIM}${item.name}${R}`;
    const price  = `${YEL}${item.price}P${R}`;
    const owned  = inventory[key] ?? 0;
    left.push(`${cursor} ${padRight(name, 16)} ${padRight(price, 8)} ${DIM}보유 ${owned}${R}`);
  }

  // 오른쪽: 아트
  const right = artToLines(art);

  // 선택 아이템 설명
  const sel = catItems[itemIdx];
  const descParts: string[] = [];
  if (sel) {
    if (sel.item.guaranteedCatch)             descParts.push(`${GRN}★ 확정 포획${R}`);
    else if ((sel.item.catchBonus ?? 0) > 0)  descParts.push(`포획률 +${Math.round(sel.item.catchBonus! * 100)}%`);
    if (sel.item.healAmount)                  descParts.push(`HP +${sel.item.healAmount} 회복`);
  }
  const desc = descParts.length ? `${DIM}${descParts.join("   ")}${R}` : "";

  const lines: string[] = [
    "",
    `  ${BLD}상점${R}   ${tabs}   ${DIM}포인트: ${YEL}${points}P${R}`,
    "  " + "─".repeat(52),
    `  ${DIM}↑↓ 아이템   ←→ 카테고리   Enter 구매   Esc 뒤로${R}`,
    "",
    ...mergeSideBySide(left, right),
    "",
  ];
  if (desc) { lines.push(`  ${desc}`); lines.push(""); }
  if (msg)  { lines.push(`  ${msg}`);  lines.push(""); }
  return lines;
}

// ── 메인 ───────────────────────────────────────────────────────
export async function shopCommand() {
  enterRaw();

  // 데이터 로드
  const [shopRes, invRes] = await Promise.all([apiGet("/api/shop"), apiGet("/api/game/inventory")]);
  if (!shopRes.ok) {
    process.stdout.write(`\n  오류: ${shopRes.data.error}\n`);
    return;
  }

  const shopItems = shopRes.data.items as Record<string, ShopItem>;
  let points      = shopRes.data.points as number;
  let inventory   = invRes.ok ? (invRes.data.inventory as Record<string, number>) : {};

  let catIdx   = 0;
  let itemIdx  = 0;
  let msg      = "";
  let currentArt: string | null = null;
  let lastItemKey = "";
  let lineCount = 0;
  let first     = true;

  // 카테고리별 아이템 배열 빌드
  function getCatItems(ci: number) {
    return CATEGORIES[ci].keys
      .filter((k) => shopItems[k])
      .map((k) => ({ key: k, item: shopItems[k] }));
  }

  while (true) {
    const catItems = getCatItems(catIdx);
    itemIdx = Math.min(itemIdx, Math.max(0, catItems.length - 1));

    // 아트 fetch (캐시)
    const selKey = catItems[itemIdx]?.key ?? "";
    if (selKey !== lastItemKey) {
      currentArt = selKey ? await getArt(selKey, catItems[itemIdx].item) : null;
      lastItemKey = selKey;
    }

    const lines = buildLines(catIdx, itemIdx, catItems, currentArt, points, inventory, msg);
    lineCount = redraw(lines, lineCount, first);
    first = false;
    msg = "";

    const key = await waitKey();

    if (key === "\x03") { process.stdout.write("\x1b[?25h"); process.exit(0); }
    else if (key === "\x1b" || key === "q") break;
    else if (key === "\x1b[A") { if (itemIdx > 0) itemIdx--; }
    else if (key === "\x1b[B") { if (itemIdx < catItems.length - 1) itemIdx++; }
    else if (key === "\x1b[D") { catIdx = (catIdx - 1 + CATEGORIES.length) % CATEGORIES.length; itemIdx = 0; lastItemKey = ""; }
    else if (key === "\x1b[C") { catIdx = (catIdx + 1) % CATEGORIES.length; itemIdx = 0; lastItemKey = ""; }
    else if (key === "\r") {
      const sel = catItems[itemIdx];
      if (!sel) continue;

      // 수량 입력 (화면 아래에 인라인으로)
      const qty = await rawNumberInput("구매 수량:");

      if (qty !== null) {
        const res = await apiPost("/api/shop/buy", { item: sel.key, quantity: qty });
        if (res.ok) {
          points = res.data.points as number;
          inventory[sel.key] = (inventory[sel.key] ?? 0) + qty;
          msg = `${GRN}✓ ${sel.item.name} ${qty}개 구매! 잔여: ${points}P${R}`;
        } else {
          msg = `${RED}✗ ${res.data.error}${R}`;
        }
      }
    }
  }

  process.stdout.write("\x1b[?25h");
  // raw mode 끄지 않음 — inquirer stdin 충돌 방지
}

export async function buyCommand(item: string, quantity: number) {
  const res = await apiPost("/api/shop/buy", { item, quantity });
  if (res.ok) console.log(`${item} ${quantity}개 구매 완료! (남은 포인트: ${res.data.points}P)`);
  else        console.error(`오류: ${res.data.error}`);
}
