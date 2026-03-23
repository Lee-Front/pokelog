import fs from "node:fs";
import path from "node:path";

const DATA_ROOT = path.resolve(process.cwd(), "data");

export function renderPokemonArt(species: string): void {
  const artPath = path.join(DATA_ROOT, "colorscripts", "small", "regular", species);
  try {
    const art = fs.readFileSync(artPath, "utf-8");
    console.log(art);
  } catch {
    console.log(`  [${species}]`);
  }
}

export function renderHpBar(current: number, max: number, width: number = 20): string {
  const ratio = Math.max(0, current / max);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  let color = "\x1b[32m"; // green
  if (ratio <= 0.25) color = "\x1b[31m"; // red
  else if (ratio <= 0.5) color = "\x1b[33m"; // yellow
  return `${color}${bar}\x1b[0m ${current}/${max}`;
}

export function renderBox(lines: string[]): void {
  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), 30);
  const top = "╔" + "═".repeat(maxLen + 2) + "╗";
  const bot = "╚" + "═".repeat(maxLen + 2) + "╝";
  console.log(top);
  for (const line of lines) {
    const pad = maxLen - stripAnsi(line).length;
    console.log("║ " + line + " ".repeat(pad) + " ║");
  }
  console.log(bot);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
