import { apiPost, apiGet } from "../api-client.js";
import { fetchBallArt, stripAnsi } from "../ui/display.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitKey(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const handler = () => { process.stdin.removeListener("data", handler); resolve(); };
    process.stdin.once("data", handler);
  });
}

const R   = "\x1b[0m";
const DIM = "\x1b[90m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const BLD = "\x1b[1m";

// ─── 빈 슬롯 ────────────────────────────────────────────────────
function makeEmptySlot(): string[] {
  const D = "\x1b[38;2;70;70;70m";
  return [
    `   ${D}▄▄▄▄▄▄▄▄▄▄${R}   `,
    ` ${D}▄▀${R}          ${D}▀▄${R} `,
    `${D}▄▀${R}            ${D}▀▄${R}`,
    `${D}█${R}              ${D}█${R}`,
    `${D}█${R}              ${D}█${R}`,
    `${D}▀▄${R}            ${D}▄▀${R}`,
    ` ${D}▀▄${R}          ${D}▄▀${R} `,
    `   ${D}▀▀▀▀▀▀▀▀▀▀${R}   `,
  ];
}

type SlotState = "empty" | "ball" | "glow" | "done";

function getSlotLine(state: SlotState, l: number, ballArt: string[], emptyArt: string[]): string {
  if (state === "empty") return emptyArt[l];
  const line = ballArt[l];
  if (state === "ball") return line;
  const color = state === "glow" ? YEL : GRN;
  return `${color}${line}${R}`;
}

// ─── 프레임 빌더 ────────────────────────────────────────────────
function buildFrame(
  slots: SlotState[],
  ballArt: string[],
  emptyArt: string[],
  status: string,
): string[] {
  const ballH = ballArt.length;
  const gap = 2;
  const lines: string[] = ["", `  ${DIM}치료 센터${R}`, ""];

  for (let row = 0; row < 2; row++) {
    for (let l = 0; l < ballH; l++) {
      let line = "  ";
      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        line += getSlotLine(slots[idx], l, ballArt, emptyArt);
        if (col < 2) line += " ".repeat(gap);
      }
      lines.push(line);
    }
    if (row === 0) lines.push("");
  }

  lines.push("");
  lines.push(`  ${status}`);
  return lines;
}

function redraw(lines: string[], lineCount: number, first: boolean): number {
  let out = "\x1b[?25l";
  if (first) {
    out += "\x1b[2J\x1b[H";
    out += lines.join("\n") + "\n";
  } else if (lineCount > 0) {
    out += `\x1b[${lineCount}A`;
    out += lines.map((l) => "\r" + l + "\x1b[K").join("\n") + "\n";
  }
  out += "\x1b[?25h";
  process.stdout.write(out);
  return lines.length;
}

// ─── 애니메이션 ─────────────────────────────────────────────────
async function playHealAnimation(
  partyCount: number,
  ballArt: string[],
  emptyArt: string[],
): Promise<void> {
  const slots: SlotState[] = Array(6).fill("empty") as SlotState[];
  let lineCount = 0;

  const draw = (first: boolean, status: string) => {
    const frame = buildFrame(slots, ballArt, emptyArt, status);
    lineCount = redraw(frame, lineCount, first);
  };

  draw(true, `${DIM}...${R}`);
  await sleep(400);

  for (let i = 0; i < partyCount; i++) {
    slots[i] = "ball";
    draw(false, `${DIM}포켓몬을 맡기는 중...${R}`);
    await sleep(250);
  }

  await sleep(200);

  for (let f = 0; f < 4; f++) {
    const state: SlotState = f % 2 === 0 ? "glow" : "ball";
    for (let i = 0; i < partyCount; i++) slots[i] = state;
    draw(false, `${YEL}치료 중...${R}`);
    await sleep(150);
  }

  for (let i = 0; i < partyCount; i++) slots[i] = "done";
  draw(false, `${GRN}${BLD}♦ 치료 완료!${R}`);
  await sleep(500);

  // 완료 후 "돌아가기" 안내 추가 (화면 갱신)
  const frame = buildFrame(slots, ballArt, emptyArt, `${GRN}${BLD}♦ 치료 완료!${R}`);
  frame.push("");
  frame.push(`  ${DIM}아무 키나 누르면 돌아갑니다${R}`);
  lineCount = redraw(frame, lineCount, false);
}

// ─── 커맨드 진입점 ──────────────────────────────────────────────
export async function healCommand() {
  const partyRes = await apiGet("/api/game/party");
  if (!partyRes.ok) {
    console.error(`오류: ${partyRes.data.error}`);
    return;
  }

  const party = partyRes.data.party as Array<{
    uid: string; species: string; level: number; hp: number; maxHp: number;
  }>;

  if (party.length === 0) {
    console.log("  파티에 포켓몬이 없습니다.");
    return;
  }

  const ballArtStr = await fetchBallArt("MonsterBall");
  const ballArtLines = ballArtStr ? ballArtStr.trimEnd().split("\n") : null;
  const ballW = ballArtLines
    ? Math.max(...ballArtLines.map((l) => stripAnsi(l).length))
    : 8;
  const ballArt  = ballArtLines ?? Array(8).fill(" ".repeat(ballW));
  const emptyArt = makeEmptySlot();

  const healPromise = apiPost("/api/game/heal", {});
  await playHealAnimation(party.length, ballArt, emptyArt);
  await healPromise;

  await waitKey();
  process.stdout.write("\x1b[?25h");
}
