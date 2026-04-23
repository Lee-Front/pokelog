import { apiGet } from "../api-client.js";
import { BLD, CYN, DIM, GRN, RED, R, YEL } from "../ui/colors.js";

interface JudgeLegacyResponse {
  legacy: true;
  species: string;
  nickname: string | null;
  message: string;
}

interface JudgePerStat {
  value: number;
  verdict: string;
}

interface JudgeResponse {
  legacy: false;
  species: string;
  nickname: string | null;
  total: number;
  verdict: string;
  ivs: {
    hp: number;
    attack: number;
    defense: number;
    spAttack: number;
    spDefense: number;
    speed: number;
  };
  perStat: Record<string, JudgePerStat>;
}

type JudgeApiPayload = JudgeLegacyResponse | JudgeResponse;

const STAT_LABELS: Array<{ key: keyof JudgeResponse["ivs"]; label: string }> = [
  { key: "hp", label: "HP" },
  { key: "attack", label: "공격" },
  { key: "defense", label: "방어" },
  { key: "spAttack", label: "특공" },
  { key: "spDefense", label: "특방" },
  { key: "speed", label: "스피드" },
];

export function renderIvBar(value: number): string {
  const filled = Math.max(0, Math.min(11, Math.floor(value / 3)));
  return "█".repeat(filled) + "░".repeat(11 - filled);
}

export function colorForIv(value: number): string {
  if (value === 31) return YEL;
  if (value >= 26) return GRN;
  if (value >= 16) return CYN;
  if (value >= 1) return DIM;
  return RED;
}

export function renderJudgeOutput(data: JudgeApiPayload): string[] {
  const lines: string[] = [];
  const nameLabel = data.nickname ? `${data.nickname} (${data.species})` : data.species;

  if (data.legacy) {
    lines.push("");
    lines.push(`  ${YEL}${data.message}${R}`);
    lines.push(`  ${DIM}대상: ${nameLabel}${R}`);
    return lines;
  }

  lines.push("");
  lines.push(`  ${BLD}── ${nameLabel} 개체값 판정 ──${R}`);
  lines.push(`  ${GRN}${BLD}${data.verdict}${R} ${DIM}(합계 ${data.total}/186)${R}`);
  lines.push("");

  for (const { key, label } of STAT_LABELS) {
    const info = data.perStat[key];
    if (!info) continue;
    const color = colorForIv(info.value);
    const prefix = info.value === 31 ? `${YEL}[V]${R} ` : "    ";
    const bar = renderIvBar(info.value);
    lines.push(`    ${label.padEnd(4)}: ${prefix}${color}${info.verdict.padEnd(10)}${R} ${bar} ${info.value}`);
  }
  return lines;
}

export async function judgeCommand(pokemonUid: string): Promise<void> {
  const res = await apiGet(`/api/user/judge/${pokemonUid}`);
  if (!res.ok) {
    const errMsg = typeof res.data.error === "string" ? res.data.error : "요청 실패";
    console.log(`${RED}오류: ${errMsg}${R}`);
    return;
  }

  const data = res.data as unknown as JudgeApiPayload;
  for (const line of renderJudgeOutput(data)) {
    console.log(line);
  }
  console.log();
}
