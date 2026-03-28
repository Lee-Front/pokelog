/** ANSI escape 시퀀스 제거 — 이 모듈이 canonical 위치 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visualWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const c = ch.codePointAt(0) ?? 0;
    w += (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
         (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) ||
         (c >= 0xFF01 && c <= 0xFF60) ? 2 : 1;
  }
  return w;
}

export function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visualWidth(s)));
}

export function artToLines(art: string | null): string[] {
  return art ? art.trimEnd().split("\n") : [];
}

export function mergeSideBySide(
  leftLines: string[], rightLines: string[], leftWidth = 20, gap = "    "
): string[] {
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = padRight(leftLines[i] ?? "", leftWidth);
    const r = rightLines[i] ?? "";
    out.push(`  ${l}${gap}${r}`);
  }
  return out;
}
