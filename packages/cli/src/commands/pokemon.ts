import { apiGet } from "../api-client.js";
import { fetchArt, renderHpBar, sideBySide, stripAnsi } from "../ui/display.js";
import { selectAction } from "../ui/prompts.js";

const DIM = "\x1b[90m";
const BLD = "\x1b[1m";
const GRN = "\x1b[32m";
const YEL = "\x1b[33m";
const R   = "\x1b[0m";

export async function pokemonCommand(uid: string) {
  const res = await apiGet(`/api/game/pokemon/${uid}`);
  if (!res.ok) {
    console.error(`오류: ${res.data.error}`);
    return;
  }
  const p = res.data.pokemon as {
    uid: string;
    species: string;
    nickname: string | null;
    level: number;
    exp: number;
    hp: number;
    maxHp: number;
    stats: { attack: number; defense: number; speed: number; spAttack: number; spDefense: number };
    moves: Array<{ id: string; pp: number; maxPp: number }>;
    caughtAt: string;
  };

  process.stdout.write("\x1b[2J\x1b[H");
  const art = await fetchArt(p.species);

  const name    = p.nickname ? `${p.nickname} ${DIM}(${p.species})${R}` : p.species;
  const hpColor = p.hp / p.maxHp <= 0.25 ? "\x1b[31m" : p.hp / p.maxHp <= 0.5 ? YEL : GRN;

  // ── 오른쪽 스탯 패널 ──────────────────────────────
  const statsLines: string[] = [
    "",
    `${BLD}${name}${R}  ${DIM}Lv.${p.level}${R}`,
    `${DIM}HP${R}  ${hpColor}${renderHpBar(p.hp, p.maxHp, 14)}${R}`,
    `${DIM}EXP${R} ${p.exp}`,
    "",
    `${DIM}${"─".repeat(24)}${R}`,
    `${DIM}공격${R}  ${String(p.stats.attack).padEnd(5)}${DIM}방어${R}  ${p.stats.defense}`,
    `${DIM}특공${R}  ${String(p.stats.spAttack).padEnd(5)}${DIM}특방${R}  ${p.stats.spDefense}`,
    `${DIM}스피드${R} ${p.stats.speed}`,
    "",
    `${DIM}${"─".repeat(24)}${R}`,
    `${DIM}기술${R}`,
    ...p.moves.map((m) => {
      const ppColor = m.pp === 0 ? "\x1b[31m" : m.pp <= m.maxPp * 0.25 ? YEL : DIM;
      return `  ${m.id.padEnd(16)}${ppColor}PP ${m.pp}/${m.maxPp}${R}`;
    }),
  ];

  const statsStr = statsLines.join("\n");

  if (art) {
    console.log();
    console.log(sideBySide(art, statsStr, 4));
  } else {
    console.log(statsStr);
  }

  console.log();
  await selectAction("", [{ name: "← 돌아가기", value: "back" }]);
}
