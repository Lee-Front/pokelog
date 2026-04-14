import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, GRN, RED, R, YEL, CYN } from "../ui/colors.js";
import { fetchArt } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { redraw } from "../ui/screen.js";
import { artToLines, padRight } from "../ui/text.js";

interface EggTier {
  tier: string;
  label: string;
  cost: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 뽑기 연출 ───────────────────────────────────────────────────

const ROLL_FRAMES = ["◐", "◓", "◑", "◒"];

async function playPullAnimation(
  tierLabel: string,
  lineCountRef: { value: number; first: boolean },
): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const frame = ROLL_FRAMES[i % ROLL_FRAMES.length];
    const lines = [
      "",
      `  ${BLD}포켓몬 뽑기${R}`,
      `  ${DIM}${"─".repeat(40)}${R}`,
      "",
      `  ${YEL}${frame}${R}  ${tierLabel} 뽑는 중...`,
      "",
    ];
    lineCountRef.value = redraw(lines, lineCountRef.value, lineCountRef.first);
    lineCountRef.first = false;
    await sleep(120 + i * 20);
  }
}

async function showResult(
  species: string,
  level: number,
  destination: string,
  remainingPoints: number,
  lineCountRef: { value: number; first: boolean },
): Promise<void> {
  const art = await fetchArt(species);
  const artLines = artToLines(art);

  const infoLines = [
    `${GRN}${BLD}${species}${R}  ${DIM}Lv.${level}${R}`,
    "",
    `${DIM}행선지:${R} ${destination === "party" ? `${GRN}파티${R}` : `${YEL}보관함${R}`}`,
    `${DIM}잔여 포인트:${R} ${YEL}${remainingPoints}P${R}`,
    "",
    `${DIM}아무 키나 누르면 돌아갑니다${R}`,
  ];

  const rightWidth = Math.max(0, ...artLines.map((l) => {
    let w = 0;
    for (const ch of l.replace(/\x1b\[[0-9;]*m/g, "")) {
      const c = ch.codePointAt(0) ?? 0;
      w += (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
           (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) ||
           (c >= 0xFF01 && c <= 0xFF60) ? 2 : 1;
    }
    return w;
  }), 20);

  const rows = Math.max(artLines.length, infoLines.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = padRight(artLines[i] ?? "", rightWidth);
    const right = infoLines[i] ?? "";
    merged.push(`  ${left}   ${right}`);
  }

  const lines = [
    "",
    `  ${BLD}포켓몬 뽑기${R}`,
    `  ${DIM}${"─".repeat(40)}${R}`,
    "",
    ...merged,
    "",
  ];

  lineCountRef.value = redraw(lines, lineCountRef.value, true);
  lineCountRef.first = false;
  await waitKey();
}

// ── 메인 UI ─────────────────────────────────────────────────────

function buildMenuLines(
  tiers: EggTier[],
  cursor: number,
  points: number,
  message: string,
): string[] {
  const lines = [
    "",
    `  ${BLD}포켓몬 뽑기${R}   ${DIM}보유 포인트:${R} ${YEL}${points}P${R}`,
    `  ${DIM}${"─".repeat(40)}${R}`,
    `  ${DIM}↑↓ 이동   Enter 뽑기   Esc 뒤로${R}`,
    "",
  ];

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const active = i === cursor;
    const canAfford = points >= tier.cost;
    const pointer = active ? `${YEL}>${R}` : " ";

    const label = active
      ? `${BLD}${tier.label}${R}`
      : canAfford
        ? `\x1b[37m${tier.label}${R}`
        : `${DIM}${tier.label}${R}`;

    const price = canAfford
      ? `${YEL}${tier.cost}P${R}`
      : `${DIM}${tier.cost}P${R}`;

    const tag = !canAfford ? ` ${RED}부족${R}` : "";
    lines.push(`${pointer} ${padRight(label, 14)} ${price}${tag}`);
  }

  lines.push("");
  lines.push(`  ${active(cursor, tiers.length)} ${DIM}뒤로${R}`);
  lines.push("");

  if (message) {
    lines.push(`  ${message}`, "");
  }

  return lines;
}

function active(cursor: number, backIdx: number): string {
  return cursor === backIdx ? `${YEL}>${R}` : " ";
}

export async function eggCommand() {
  enterRaw();

  const res = await apiGet("/api/game/eggs");
  if (!res.ok) {
    process.stdout.write(`  ${RED}${res.data.error}${R}\n`);
    return;
  }

  let points = Number(res.data.points ?? 0);
  const tiers = (res.data.tiers as EggTier[]) ?? [];

  if (tiers.length === 0) {
    process.stdout.write(`  ${DIM}뽑기 가능한 티어가 없습니다.${R}\n`);
    return;
  }

  const totalOptions = tiers.length + 1; // tiers + 뒤로
  let cursor = 0;
  let lineCount = 0;
  let first = true;
  let message = "";

  while (true) {
    cursor = Math.min(cursor, totalOptions - 1);
    const lines = buildMenuLines(tiers, cursor, points, message);
    lineCount = redraw(lines, lineCount, first);
    first = false;
    message = "";

    const key = await waitKey();
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b" || key === "q") break;

    if (key === "\x1b[A" && cursor > 0) {
      cursor--;
      continue;
    }
    if (key === "\x1b[B" && cursor < totalOptions - 1) {
      cursor++;
      continue;
    }
    if (key !== "\r") continue;

    // 뒤로
    if (cursor === tiers.length) break;

    const tier = tiers[cursor];
    if (points < tier.cost) {
      message = `${RED}포인트가 부족합니다 (필요: ${tier.cost}P)${R}`;
      continue;
    }

    // 뽑기 실행
    const ref = { value: lineCount, first: true };
    await playPullAnimation(tier.label, ref);

    const pullRes = await apiPost("/api/game/eggs/pull", { tier: tier.tier });
    if (!pullRes.ok) {
      message = `${RED}${pullRes.data.error}${R}`;
      first = true;
      continue;
    }

    const pokemon = pullRes.data.pokemon as { species: string; level: number };
    const destination = String(pullRes.data.destination ?? "storage");
    points = Number(pullRes.data.remainingPoints ?? 0);

    await showResult(pokemon.species, pokemon.level, destination, points, ref);
    first = true;
  }

  process.stdout.write("\x1b[?25h");
}
