import { getServerUrl } from "../config.js";

export async function renderPokemonArt(species: string): Promise<void> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return;
    const res = await fetch(`${serverUrl}/api/art/${species}`);
    if (res.ok) {
      const art = await res.text();
      console.log(art);
    } else {
      console.log(`  [${species}]`);
    }
  } catch {
    console.log(`  [${species}]`);
  }
}

export async function fetchArt(species: string): Promise<string | null> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return null;
    const res = await fetch(`${serverUrl}/api/art/${species}`);
    if (res.ok) return await res.text();
    return null;
  } catch {
    return null;
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
