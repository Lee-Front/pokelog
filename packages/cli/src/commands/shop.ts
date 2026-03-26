import { apiGet, apiPost } from "../api-client.js";
import { fetchBallArt } from "../ui/display.js";

type FullShopItem = {
  name: string;
  price: number;
  catchBonus?: number;
  healAmount?: number;
  guaranteedCatch?: boolean;
};

const CATEGORIES = [
  { name: "몬스터볼", keys: ["pokeball", "safariball", "greatball", "ultraball", "masterball"] },
  { name: "상처약",   keys: ["potion", "superPotion", "hyperPotion"] },
];

const BALL_KEYS = new Set(["pokeball", "safariball", "greatball", "ultraball", "masterball"]);

const DIM = "\x1b[90m";
const R   = "\x1b[0m";
const YEL = "\x1b[1m\x1b[33m";
const BLD = "\x1b[1m";
const GRN = "\x1b[32m";
const RED = "\x1b[31m";
const CYN = "\x1b[36m";

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function enterRaw() {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function exitRaw() {
  try { process.stdin.setRawMode(false); } catch { /* ignore */ }
  process.stdin.pause();
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

function rawNumberInput(label: string): Promise<number | null> {
  return new Promise((resolve) => {
    let buf = "";
    const redraw = () => process.stdout.write(`\r  ${label} ${buf}\x1b[K`);
    process.stdout.write("\n");
    redraw();

    const handler = (chunk: string) => {
      if (chunk === "\x03") { exitRaw(); process.exit(0); }
      else if (chunk === "\x1b") {
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        resolve(null);
      } else if (chunk === "\r") {
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        const n = parseInt(buf, 10);
        resolve(Number.isFinite(n) && n > 0 ? n : null);
      } else if ((chunk === "\x7f" || chunk === "\x08") && buf.length > 0) {
        buf = buf.slice(0, -1);
        redraw();
      } else if (/^\d$/.test(chunk) && buf.length < 5) {
        buf += chunk;
        redraw();
      }
    };
    process.stdin.on("data", handler);
  });
}

// ── 카테고리 선택 ──────────────────────────────────────────────────
async function rawSelectCategory(
  categories: typeof CATEGORIES,
  points: number,
): Promise<number | null> {
  let idx = 0;
  const total = categories.length;
  let lineCount = 0;

  const draw = (first: boolean) => {
    const lines: string[] = [
      "",
      `  상점   ${DIM}보유 포인트: ${YEL}${points}P${R}`,
      "  " + "─".repeat(28),
      "",
    ];
    for (let i = 0; i < total; i++) {
      const cursor = i === idx ? `${CYN}❯${R}` : " ";
      lines.push(`  ${cursor} ${categories[i].name}`);
    }
    lines.push(`    ${DIM}─────────────${R}`);
    const exitCursor = idx === total ? `${CYN}❯${R}` : " ";
    lines.push(`  ${exitCursor} ${DIM}← 돌아가기${R}`);
    lines.push("");
    lines.push(`  ${DIM}↑ ↓ 탐색    Enter 선택${R}`);

    let out = "\x1b[?25l"; // hide cursor while drawing
    if (first) {
      out += "\x1b[2J\x1b[H";
      lineCount = 0;
    } else if (lineCount > 0) {
      out += `\x1b[${lineCount}A\x1b[0J`;
    }
    out += lines.join("\n") + "\n";
    out += "\x1b[?25h"; // restore cursor
    process.stdout.write(out);
    lineCount = lines.length;
  };

  draw(true);

  while (true) {
    const key = await waitKey();
    if (key === "\x03") { exitRaw(); process.exit(0); }
    else if (key === "\x1b[A") { idx = (idx - 1 + total + 1) % (total + 1); draw(false); }
    else if (key === "\x1b[B") { idx = (idx + 1) % (total + 1); draw(false); }
    else if (key === "\r") {
      if (idx === total) return null;
      return idx;
    } else if (key === "\x1b" || key === "q") {
      return null;
    }
  }
}

// ── 캐러셀 ────────────────────────────────────────────────────────
async function runCarousel(
  keys: string[],
  items: Record<string, FullShopItem>,
  inventory: Record<string, number>,
  initialPoints: number,
): Promise<void> {
  const available = keys.filter((k) => items[k]);
  if (available.length === 0) return;

  const arts = await Promise.all(
    available.map((k) => (BALL_KEYS.has(k) ? fetchBallArt(k) : Promise.resolve(null))),
  );

  let idx    = 0;
  let points = initialPoints;
  let lineCount = 0;

  const draw = (first: boolean) => {
    const key   = available[idx];
    const item  = items[key];
    const owned = inventory[key] ?? 0;
    const art   = arts[idx];

    const lines: string[] = [""];
    lines.push(`  ${DIM}← ${idx + 1} / ${available.length} →    보유 포인트: ${YEL}${points}P${R}`);
    lines.push("");

    if (art) {
      for (const line of art.trimEnd().split("\n")) lines.push(`    ${line}`);
    } else if (item.healAmount) {
      for (let i = 0; i < 3; i++) lines.push("");
      lines.push(`           ${GRN}+${item.healAmount} HP${R}`);
      for (let i = 0; i < 4; i++) lines.push("");
    } else {
      for (let i = 0; i < 8; i++) lines.push("");
    }

    lines.push("");
    lines.push(`  ${BLD}${item.name}${R}`);

    const extras: string[] = [];
    if (item.guaranteedCatch)            extras.push(`${GRN}★ 확정 포획${R}`);
    else if ((item.catchBonus ?? 0) > 0) extras.push(`${DIM}포획보너스 +${Math.round(item.catchBonus! * 100)}%${R}`);
    if (item.healAmount)                 extras.push(`${DIM}회복 ${item.healAmount}HP${R}`);

    lines.push(`  가격:  ${YEL}${item.price}P${R}   ${extras.join("   ")}`);
    lines.push(`  보유:  ${owned}개`);
    lines.push("");
    lines.push(`  ${DIM}← → 탐색    Enter 구매    Esc 뒤로${R}`);

    let out = "\x1b[?25l"; // hide cursor while drawing
    if (first) {
      out += "\x1b[2J\x1b[H";
      lineCount = 0;
    } else if (lineCount > 0) {
      out += `\x1b[${lineCount}A\x1b[0J`;
    }
    out += lines.join("\n") + "\n";
    out += "\x1b[?25h"; // restore cursor
    process.stdout.write(out);
    lineCount = lines.length;
  };

  draw(true);

  while (true) {
    const key = await waitKey();

    if (key === "\x03") { exitRaw(); process.exit(0); }
    else if (key === "\x1b[D") { idx = (idx - 1 + available.length) % available.length; draw(false); }
    else if (key === "\x1b[C") { idx = (idx + 1) % available.length; draw(false); }
    else if (key === "\r") {
      const currentKey  = available[idx];
      const currentItem = items[currentKey];

      draw(false);
      const qty = await rawNumberInput("수량:");

      if (qty !== null) {
        const res = await apiPost("/api/shop/buy", { item: currentKey, quantity: qty });
        if (res.ok) {
          points = res.data.points as number;
          inventory[currentKey] = (inventory[currentKey] ?? 0) + qty;
          process.stdout.write(`  ${GRN}✓ ${currentItem.name} ${qty}개 구매!${R}\n`);
        } else {
          process.stdout.write(`  ${RED}✗ ${res.data.error}${R}\n`);
        }
        await new Promise((r) => setTimeout(r, 700));
      }

      draw(true);  // full clear after Enter flow (number input added untracked lines)
    } else if (key === "\x1b" || key === "q") {
      return;
    }
  }
}

// ── 메인 진입점 ───────────────────────────────────────────────────
export async function shopCommand() {
  enterRaw();
  await shopLoop();
  // raw mode는 끄지 않음 — inquirer가 자체적으로 setRawMode(true/false)를
  // 관리하므로, 여기서 setRawMode(false)하면 그 사이 창구에서 키입력이
  // OS 버퍼에 쌓여 엔터 전까지 안 먹히는 버그가 생긴다
}

async function shopLoop() {
  while (true) {
    const [shopRes, invRes] = await Promise.all([
      apiGet("/api/shop"),
      apiGet("/api/game/inventory"),
    ]);

    if (!shopRes.ok) {
      clearScreen();
      process.stdout.write(`\n  오류: ${shopRes.data.error}\n\n  아무 키나 누르세요...\n`);
      await waitKey();
      return;
    }

    const items     = shopRes.data.items as Record<string, FullShopItem>;
    const points    = shopRes.data.points as number;
    const inventory = invRes.ok ? (invRes.data.inventory as Record<string, number>) : {};

    const available = CATEGORIES.filter((c) => c.keys.some((k) => items[k]));

    const catIdx = await rawSelectCategory(available, points);
    if (catIdx === null) return;

    await runCarousel(available[catIdx].keys, items, inventory, points);
  }
}

export async function buyCommand(item: string, quantity: number) {
  const res = await apiPost("/api/shop/buy", { item, quantity });
  if (res.ok) {
    console.log(`${item} ${quantity}개 구매 완료! (남은 포인트: ${res.data.points}P)`);
  } else {
    console.error(`오류: ${res.data.error}`);
  }
}
