import { apiGet, apiPost } from "../api-client.js";
import { BLD, DIM, GRN, RED, R, YEL } from "../ui/colors.js";
import { fetchArt, fetchEggArt } from "../ui/display.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";
import { redraw } from "../ui/screen.js";
import { artToLines, padRight, visualWidth } from "../ui/text.js";
import { mergeSideBySide } from "../ui/text.js";

interface EggTier {
  tier: string;
  label: string;
  cost: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 티어별 알 아트 이름 매핑 ────────────────────────────────────

const EGG_ART_MAP: Record<string, string> = {
  common: "commonEgg",
  rare: "rareEgg",
  epic: "epicEgg",
  legend: "LegendaryEgg",
  manaphy: "manaphyEgg",
};

// ── 뽑기 연출 ───────────────────────────────────────────────────

const ROLL_FRAMES = ["◐", "◓", "◑", "◒"];

async function playPullAnimation(
  tierLabel: string,
  eggArt: string | null,
  lineCountRef: { value: number; first: boolean },
): Promise<void> {
  const artLines = artToLines(eggArt);
  for (let i = 0; i < 8; i++) {
    const frame = ROLL_FRAMES[i % ROLL_FRAMES.length];
    const infoLines = [
      `${YEL}${frame}${R}  ${tierLabel} 뽑는 중...`,
    ];
    const merged = artLines.length > 0
      ? mergeSideBySide(artLines, infoLines)
      : infoLines.map((l) => `  ${l}`);
    const lines = [
      "",
      `  ${BLD}포켓몬 뽑기${R}`,
      `  ${DIM}${"─".repeat(40)}${R}`,
      "",
      ...merged,
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

  const merged = artLines.length > 0
    ? mergeSideBySide(artLines, infoLines)
    : infoLines.map((l) => `  ${l}`);

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
  art: string | null,
  message: string,
): string[] {
  const menuLines: string[] = [];

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
    menuLines.push(`${pointer} ${padRight(label, 14)} ${price}${tag}`);
  }

  menuLines.push("");
  menuLines.push(`${cursor === tiers.length ? `${YEL}>${R}` : " "} ${DIM}뒤로${R}`);

  const artLines = artToLines(art);
  const merged = artLines.length > 0
    ? mergeSideBySide(artLines, menuLines)
    : menuLines.map((l) => `  ${l}`);

  const lines = [
    "",
    `  ${BLD}포켓몬 뽑기${R}   ${DIM}보유 포인트:${R} ${YEL}${points}P${R}`,
    `  ${DIM}${"─".repeat(40)}${R}`,
    `  ${DIM}↑↓ 이동   Enter 뽑기   Esc 뒤로${R}`,
    "",
    ...merged,
    "",
  ];

  if (message) {
    lines.push(`  ${message}`, "");
  }

  return lines;
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

  // 알 아트 캐시
  const eggArtCache = new Map<string, string | null>();
  async function getEggArt(tier: string): Promise<string | null> {
    if (eggArtCache.has(tier)) return eggArtCache.get(tier)!;
    const artName = EGG_ART_MAP[tier] ?? `${tier}Egg`;
    const art = await fetchEggArt(artName);
    eggArtCache.set(tier, art);
    return art;
  }

  const totalOptions = tiers.length + 1; // tiers + 뒤로
  let cursor = 0;
  let lineCount = 0;
  let first = true;
  let message = "";
  let currentArt: string | null = null;
  let lastTier = "";

  while (true) {
    cursor = Math.min(cursor, totalOptions - 1);

    // 커서에 해당하는 티어의 알 아트 로드
    const tierKey = cursor < tiers.length ? tiers[cursor].tier : "";
    if (tierKey !== lastTier) {
      currentArt = tierKey ? await getEggArt(tierKey) : null;
      lastTier = tierKey;
    }

    const lines = buildMenuLines(tiers, cursor, points, currentArt, message);
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
    const eggArt = await getEggArt(tier.tier);
    const ref = { value: lineCount, first: true };
    await playPullAnimation(tier.label, eggArt, ref);

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
