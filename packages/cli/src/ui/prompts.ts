import { stripAnsi } from "./display.js";
import { CYN, DIM, R } from "./colors.js";
import { enterRaw, waitKey } from "./raw-mode.js";

interface SelectChoice<T> {
  name: string;
  value: T;
  disabled?: boolean;
}

interface SeparatorItem {
  separator: string;
}

export type SelectItem<T> = SelectChoice<T> | SeparatorItem;

function isSeparator<T>(item: SelectItem<T>): item is SeparatorItem {
  return "separator" in item;
}

function leaveRaw() {
  // Keep stdin resumed for subsequent prompt loops.
}

function printableChunk(key: string): string {
  if (key.startsWith("\x1b")) {
    return "";
  }
  return key.replace(/[\x00-\x1f\x7f]/g, "");
}

export async function rawSelect<T>(
  message: string,
  items: SelectItem<T>[],
  opts?: { pageSize?: number; default?: T },
): Promise<T | null> {
  enterRaw();
  process.stdout.write("\x1b[?25l");
  const pageSize = opts?.pageSize ?? 12;
  const selectableIndices = items
    .map((item, i) => (!isSeparator(item) && !item.disabled ? i : -1))
    .filter((i) => i >= 0);

  if (selectableIndices.length === 0) {
    process.stdout.write("\x1b[?25h");
    leaveRaw();
    return null;
  }

  let cursorIdx = 0;
  if (opts?.default !== undefined) {
    const found = selectableIndices.findIndex((i) => {
      const item = items[i] as SelectChoice<T>;
      return item.value === opts.default;
    });
    if (found >= 0) cursorIdx = found;
  }

  let scroll = 0;
  let lineCount = 0;

  while (true) {
    const cursor = selectableIndices[cursorIdx];

    if (cursor < scroll) scroll = cursor;
    if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;

    const lines: string[] = [];
    lines.push(`${DIM}?${R} ${message}`);

    const end = Math.min(scroll + pageSize, items.length);
    for (let i = scroll; i < end; i++) {
      const item = items[i];
      if (isSeparator(item)) {
        lines.push(item.separator);
      } else if (item.disabled) {
        lines.push(`  ${DIM}${stripAnsi(item.name)}${R}`);
      } else if (i === cursor) {
        lines.push(`${CYN}>${R} ${item.name}`);
      } else {
        lines.push(`  ${item.name}`);
      }
    }

    let out = "";
    if (lineCount > 0) out += `\x1b[${lineCount}A`;
    for (const line of lines) {
      out += `\r${line}\x1b[K\n`;
    }
    if (lines.length < lineCount) {
      const extra = lineCount - lines.length;
      for (let i = 0; i < extra; i++) out += "\r\x1b[K\n";
      out += `\x1b[${extra}A`;
    }
    process.stdout.write(out);
    lineCount = lines.length;

    const key = await waitKey();
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b" || key === "q") {
      process.stdout.write("\x1b[?25h");
      leaveRaw();
      return null;
    }
    if (key === "\r" || key === "\n") {
      process.stdout.write("\x1b[?25h");
      leaveRaw();
      const selected = items[cursor] as SelectChoice<T>;
      return selected.value;
    }
    if (key === "\x1b[A" || key === "k") {
      if (cursorIdx > 0) cursorIdx--;
    }
    if (key === "\x1b[B" || key === "j") {
      if (cursorIdx < selectableIndices.length - 1) cursorIdx++;
    }
  }
}

export function separator(text: string): SeparatorItem {
  return { separator: text };
}

export async function rawInput(prompt: string): Promise<string | null> {
  enterRaw();
  process.stdout.write(`\x1b[90m?\x1b[0m ${prompt}`);

  let buf = "";
  while (true) {
    const key = await waitKey();

    if (key === "\x03") {
      process.stdout.write("\n\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b") {
      process.stdout.write("\n");
      leaveRaw();
      return null;
    }
    if (key === "\r" || key === "\n") {
      process.stdout.write("\n");
      leaveRaw();
      return buf;
    }
    if (key === "\x7f" || key === "\b") {
      if (buf.length > 0) {
        buf = buf.slice(0, -1);
        process.stdout.write("\b \b");
      }
      continue;
    }

    const printable = printableChunk(key);
    if (printable.length > 0) {
      buf += printable;
      process.stdout.write(printable);
    }
  }
}

export async function rawPassword(prompt: string): Promise<string | null> {
  enterRaw();
  process.stdout.write(`\x1b[90m?\x1b[0m ${prompt}`);

  let buf = "";
  while (true) {
    const key = await waitKey();

    if (key === "\x03") {
      process.stdout.write("\n\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b") {
      process.stdout.write("\n");
      leaveRaw();
      return null;
    }
    if (key === "\r" || key === "\n") {
      process.stdout.write("\n");
      leaveRaw();
      return buf;
    }
    if (key === "\x7f" || key === "\b") {
      if (buf.length > 0) {
        buf = buf.slice(0, -1);
        process.stdout.write("\b \b");
      }
      continue;
    }

    const printable = printableChunk(key);
    if (printable.length > 0) {
      buf += printable;
      process.stdout.write("*".repeat(printable.length));
    }
  }
}

export async function selectAction<T extends string>(
  message: string,
  choices: { name: string; value: T }[],
): Promise<T> {
  const result = await rawSelect(message, choices);
  return (result ?? "__back__") as T;
}

export async function inputPrompt(message: string): Promise<string> {
  return (await rawInput(message + " ")) ?? "";
}

export async function passwordPrompt(message: string): Promise<string> {
  return (await rawPassword(message + " ")) ?? "";
}

export async function numberPrompt(message: string): Promise<number> {
  const val = await rawInput(message + " ");
  return parseInt(val ?? "", 10) || 0;
}

export async function rawConfirm(message: string): Promise<boolean> {
  const { enterRaw, waitKey, handleCtrlC } = await import("./raw-mode.js");
  process.stdout.write(`  ${message} (y/n) `);
  enterRaw();
  while (true) {
    const key = await waitKey();
    handleCtrlC(key);
    if (key === "y" || key === "Y") {
      process.stdout.write("y\n");
      return true;
    }
    if (key === "n" || key === "N" || key === "\x1b") {
      process.stdout.write("n\n");
      return false;
    }
  }
}
