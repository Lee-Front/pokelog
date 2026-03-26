import { apiPost, apiGet } from "../api-client.js";
import { selectAction } from "../ui/prompts.js";
import { getServerUrl } from "../config.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const R = "\x1b[0m";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── 볼 아트 로드 ──────────────────────────────────────────────────
async function fetchBallArt(name: string): Promise<string[] | null> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return null;
    const res = await fetch(`${serverUrl}/api/art/ball/${name}`);
    if (!res.ok) return null;
    const text = await res.text();
    return text.replace(/\r/g, "").trimEnd().split("\n");
  } catch {
    return null;
  }
}

// ─── 빈 슬롯 (동그란 원형 아웃라인 — 소켓/슬롯 느낌) ──────────────
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

// ─── 슬롯 상태 ─────────────────────────────────────────────────────
type SlotState = "empty" | "ball" | "glow" | "done";

function getSlotLine(
  state: SlotState,
  l: number,
  ballArt: string[],
  emptyArt: string[],
): string {
  if (state === "empty") return emptyArt[l];
  const line = ballArt[l];
  if (state === "ball") return line;
  const color = state === "glow" ? "\x1b[33m" : "\x1b[32m";
  return `${color}${line}${R}`;
}

// ─── 프레임 빌더 (슬롯만, 테두리 없음) ─────────────────────────────
function buildFrame(
  slots: SlotState[],
  ballArt: string[],
  emptyArt: string[],
): string[] {
  const ballH = ballArt.length;
  const gap = 2;
  const lines: string[] = [];

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

  return lines;
}

// ─── 애니메이션 ─────────────────────────────────────────────────────
async function playHealAnimation(
  partyCount: number,
  ballArt: string[],
  emptyArt: string[],
): Promise<void> {
  const slots: SlotState[] = Array(6).fill("empty") as SlotState[];
  let totalLines = 0;

  const draw = (redraw: boolean) => {
    const frame = buildFrame(slots, ballArt, emptyArt);
    totalLines = frame.length;
    let out = "\x1b[?25l";
    if (redraw) out += `\x1b[${totalLines}A\x1b[0J`;
    out += frame.join("\n") + "\n\x1b[?25h";
    process.stdout.write(out);
  };

  draw(false);
  await sleep(500);

  for (let i = 0; i < partyCount; i++) {
    slots[i] = "ball";
    draw(true);
    await sleep(300);
  }

  await sleep(200);

  for (let f = 0; f < 4; f++) {
    const state: SlotState = f % 2 === 0 ? "glow" : "ball";
    for (let i = 0; i < partyCount; i++) slots[i] = state;
    draw(true);
    await sleep(150);
  }

  for (let i = 0; i < partyCount; i++) slots[i] = "done";
  draw(true);
  await sleep(600);
}

// ─── 커맨드 진입점 ──────────────────────────────────────────────────
export async function healCommand() {
  const partyRes = await apiGet("/api/game/party");
  if (!partyRes.ok) {
    console.error(`오류: ${partyRes.data.error}`);
    await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
    return;
  }

  const party = partyRes.data.party as Array<{
    uid: string;
    species: string;
    level: number;
    hp: number;
    maxHp: number;
  }>;

  if (party.length === 0) {
    console.log("  파티에 포켓몬이 없습니다.");
    await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
    return;
  }

  const ballArtLines = await fetchBallArt("MonsterBall");
  const ballW = ballArtLines
    ? Math.max(...ballArtLines.map((l) => stripAnsi(l).length))
    : 8;
  const ballArt = ballArtLines ?? Array(8).fill(" ".repeat(ballW));
  const emptyArt = makeEmptySlot();

  process.stdout.write("\x1b[2J\x1b[H");
  console.log("");

  const healPromise = apiPost("/api/game/heal", {});
  await playHealAnimation(party.length, ballArt, emptyArt);
  await healPromise;

  console.log(`\n  \x1b[1m\x1b[32m♦ 치료 완료!\x1b[0m\n`);

  await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
}
