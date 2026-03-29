import { apiGet } from "../api-client.js";
import { BLD, CYN, DIM, GRN, R, YEL } from "../ui/colors.js";
import { enterRaw, waitKey } from "../ui/raw-mode.js";

interface HistoryTotals {
  [source: string]: {
    points: number;
    exp: number;
    count: number;
  };
}

interface HistoryEntry {
  timestamp: string;
  source: string;
  type: string;
  points: number;
  exp: number;
  summary: string;
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

export async function historyCommand(limit = 20) {
  const res = await apiGet(`/api/game/history?limit=${limit}`);
  if (!res.ok) {
    console.error(`오류: ${String(res.data.error)}`);
    return;
  }

  const totals = (res.data.totals as HistoryTotals | undefined) ?? {};
  const recent = (res.data.recent as HistoryEntry[] | undefined) ?? [];
  const sources = Object.entries(totals).sort((a, b) => b[1].points - a[1].points);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printHistoryPage(sources, recent, 0, Math.max(1, recent.length));
    return;
  }

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(recent.length / pageSize));
  let page = 0;

  enterRaw();
  while (true) {
    printHistoryPage(sources, recent, page, pageSize);
    const key = await waitKey();

    if (key === "\x03") process.exit(0);
    if (key === "\x1b" || key === "q" || key === "\r") return;
    if ((key === "\x1b[D" || key === "h") && page > 0) page -= 1;
    if ((key === "\x1b[C" || key === "l") && page < totalPages - 1) page += 1;
  }
}

function printHistoryPage(
  sources: Array<[string, { points: number; exp: number; count: number }]>,
  recent: HistoryEntry[],
  page: number,
  pageSize: number,
) {
  const totalPages = Math.max(1, Math.ceil(recent.length / pageSize));
  const pageBadge = `${CYN}${BLD}[${page + 1}/${totalPages}]${R}`;
  const navHint = `${YEL}< / >${R} ${DIM}move${R}`;
  const closeHint = `${GRN}Esc${R} ${DIM}close${R}`;

  clearScreen();
  console.log(`  ${BLD}적립 이력${R}`);
  console.log();

  if (sources.length === 0) {
    console.log(`  ${DIM}아직 적립 이력이 없습니다.${R}`);
    console.log();
    console.log(`  ${pageBadge}   ${closeHint}`);
    return;
  }

  console.log(`  ${CYN}소스별 누적${R}`);
  for (const [source, value] of sources) {
    console.log(`  ${source.padEnd(10)}  ${YEL}${value.points}P${R}  ${GRN}${value.exp} EXP${R}  ${DIM}${value.count}건${R}`);
  }

  console.log();
  console.log(`  ${CYN}최근 적립${R}`);
  if (recent.length === 0) {
    console.log(`  ${DIM}최근 적립 기록이 없습니다.${R}`);
    console.log();
    console.log(`  ${pageBadge}   ${closeHint}`);
    return;
  }

  const start = page * pageSize;
  const pageEntries = recent.slice(start, start + pageSize);
  for (const entry of pageEntries) {
    console.log(`  ${entry.source.padEnd(10)} ${YEL}${entry.points}P${R} ${GRN}${entry.exp} EXP${R} ${DIM}${entry.timestamp}${R}`);
    console.log(`  ${DIM}${entry.summary}${R}`);
  }

  console.log();
  console.log(`  ${pageBadge}   ${navHint}   ${closeHint}`);
}
