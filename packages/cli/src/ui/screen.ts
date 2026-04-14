import { printHeader, redraw } from "./display.js";
import { DIM, GRN, RED, R, YEL } from "./colors.js";
import { type SelectItem } from "./prompts.js";
import { enterRaw, waitKey } from "./raw-mode.js";

export function enterAltScreen(): void {
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[2J\x1b[H");
}

export function leaveAltScreen(): void {
  process.stdout.write("\x1b[?1049l");
}

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

export async function resetScreen(screen: string | null): Promise<void> {
  clearScreen();
  await printHeader(screen);
}

export type ScreenMessageTone = "info" | "success" | "warn" | "error";

export interface ScreenMessage {
  tone: ScreenMessageTone;
  text: string;
}

export interface MenuLoopTransition<State> {
  state: State;
  close?: boolean;
}

export interface MenuLoopOptions<State, Data, Value> {
  initialState: State;
  pageSize?: number;
  defaultValue?: (data: Data, state: State) => Value | undefined;
  load: (state: State) => Promise<Data>;
  prompt: (data: Data, state: State) => string;
  items: (data: Data, state: State) => SelectItem<Value>[];
  onSelect: (
    selected: Value,
    data: Data,
    state: State,
  ) => Promise<MenuLoopTransition<State> | State | void>;
}

export interface FrameSelectOptions<Value> {
  pageSize?: number;
  defaultValue?: Value;
}

export interface FrameInputOptions {
  initialValue?: string;
  mask?: boolean;
  preserveFrame?: boolean;
}

interface SelectChoice<T> {
  name: string;
  value: T;
  disabled?: boolean;
}

interface SeparatorItem {
  separator: string;
}

function isSeparator<T>(item: SelectItem<T>): item is SeparatorItem {
  return "separator" in item;
}

function isSelectable<T>(item: SelectItem<T>): item is SelectChoice<T> {
  return !isSeparator(item) && !item.disabled;
}

function printableChunk(key: string): string {
  if (key.startsWith("\x1b")) {
    return "";
  }
  return key.replace(/[\x00-\x1f\x7f]/g, "");
}

export function formatScreenMessage(message?: ScreenMessage | null): string {
  if (!message) {
    return "";
  }

  const color = message.tone === "success"
    ? GRN
    : message.tone === "error"
      ? RED
      : message.tone === "warn"
        ? YEL
        : DIM;
  return `${color}${message.text}${R}`;
}

export async function selectFrame<Value>(
  prompt: string,
  items: SelectItem<Value>[],
  options?: FrameSelectOptions<Value>,
): Promise<Value | null> {
  let lineCount = 0;
  let first = true;
  const pageSize = options?.pageSize ?? 12;
  const selectableIndices = items
    .map((item, index) => (isSelectable(item) ? index : -1))
    .filter((index) => index >= 0);

  if (selectableIndices.length === 0) {
    const lines = [
      `${DIM}?${R} ${prompt}`,
      ...items.map((item) => isSeparator(item) ? item.separator : `  ${item.name}`),
    ];
    redraw(lines, lineCount, first);
    return null;
  }

  let cursorIdx = 0;
  if (options?.defaultValue !== undefined) {
    const found = selectableIndices.findIndex((index) => {
      const item = items[index] as SelectChoice<Value>;
      return item.value === options.defaultValue;
    });
    if (found >= 0) {
      cursorIdx = found;
    }
  }

  let scroll = 0;
  enterRaw();

  while (true) {
    const cursor = selectableIndices[cursorIdx];
    if (cursor < scroll) scroll = cursor;
    if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;

    const lines: string[] = [];
    lines.push(`${DIM}?${R} ${prompt}`);

    const end = Math.min(scroll + pageSize, items.length);
    for (let index = scroll; index < end; index++) {
      const item = items[index];
      if (isSeparator(item)) {
        lines.push(item.separator);
      } else if (item.disabled) {
        lines.push(`  ${DIM}${item.name}${R}`);
      } else if (index === cursor) {
        lines.push(`${YEL}>${R} ${item.name}`);
      } else {
        lines.push(`  ${item.name}`);
      }
    }

    lineCount = redraw(lines, lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b" || key === "q") {
      return null;
    }
    if (key === "\x1b[A" || key === "k") {
      if (cursorIdx > 0) cursorIdx--;
      continue;
    }
    if (key === "\x1b[B" || key === "j") {
      if (cursorIdx < selectableIndices.length - 1) cursorIdx++;
      continue;
    }
    if (key !== "\r" && key !== "\n") {
      continue;
    }

    const selected = items[cursor] as SelectChoice<Value>;
    return selected.value;
  }
}

export async function confirmFrame(
  prompt: string,
  labels?: { yes?: string; no?: string },
): Promise<boolean> {
  const result = await selectFrame(prompt, [
    { name: labels?.yes ?? "Yes", value: "yes" },
    { name: labels?.no ?? "No", value: "no" },
  ]);
  return result === "yes";
}

export async function inputFrame(
  prompt: string,
  options?: FrameInputOptions,
): Promise<string | null> {
  let lineCount = 0;
  let first = !options?.preserveFrame;
  let value = options?.initialValue ?? "";
  enterRaw();

  while (true) {
    const renderedValue = options?.mask ? "*".repeat(value.length) : value;
    lineCount = redraw([
      `${DIM}?${R} ${prompt}`,
      `${YEL}>${R} ${renderedValue}`,
    ], lineCount, first);
    first = false;

    const key = await waitKey();
    if (key === "\x03") {
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b") {
      return null;
    }
    if (key === "\r" || key === "\n") {
      return value;
    }
    if (key === "\x7f" || key === "\b") {
      if (value.length > 0) {
        value = value.slice(0, -1);
      }
      continue;
    }

    const printable = printableChunk(key);
    if (printable.length > 0) {
      value += printable;
    }
  }
}

export async function passwordFrame(
  prompt: string,
  options?: Omit<FrameInputOptions, "mask">,
): Promise<string | null> {
  return inputFrame(prompt, { ...options, mask: true });
}

export async function runMenuLoop<State, Data, Value>(
  options: MenuLoopOptions<State, Data, Value>,
): Promise<State> {
  let state = options.initialState;
  let lineCount = 0;
  let first = true;
  let lastSelected: Value | undefined;

  enterRaw();
  process.stdout.write("\x1b[?25l");

  while (true) {
    const data = await options.load(state);
    const items = options.items(data, state);
    const pageSize = options.pageSize ?? 12;
    const selectableIndices = items
      .map((item, index) => (isSelectable(item) ? index : -1))
      .filter((index) => index >= 0);

    if (selectableIndices.length === 0) {
      const lines = [`${DIM}?${R} ${options.prompt(data, state)}`, ...items.map((item) => isSeparator(item) ? item.separator : `  ${item.name}`)];
      lineCount = redraw(lines, lineCount, first);
      first = false;
      process.stdout.write("\x1b[?25h");
      return state;
    }

    const preferredValue = options.defaultValue?.(data, state) ?? lastSelected;
    let cursorIdx = 0;
    if (preferredValue !== undefined) {
      const found = selectableIndices.findIndex((index) => {
        const item = items[index] as SelectChoice<Value>;
        return item.value === preferredValue;
      });
      if (found >= 0) {
        cursorIdx = found;
      }
    }

    let scroll = 0;

    while (true) {
      const cursor = selectableIndices[cursorIdx];
      if (cursor < scroll) scroll = cursor;
      if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;

      const lines: string[] = [];
      lines.push(`${DIM}?${R} ${options.prompt(data, state)}`);

      const end = Math.min(scroll + pageSize, items.length);
      for (let index = scroll; index < end; index++) {
        const item = items[index];
        if (isSeparator(item)) {
          lines.push(item.separator);
        } else if (item.disabled) {
          lines.push(`  ${DIM}${item.name}${R}`);
        } else if (index === cursor) {
          lines.push(`${YEL}>${R} ${item.name}`);
        } else {
          lines.push(`  ${item.name}`);
        }
      }

      lineCount = redraw(lines, lineCount, first);
      first = false;

      const key = await waitKey();
      if (key === "\x03") {
        process.stdout.write("\x1b[?25h");
        process.exit(0);
      }
      if (key === "\x1b" || key === "q") {
        process.stdout.write("\x1b[?25h");
        return state;
      }
      if (key === "\x1b[A" || key === "k") {
        if (cursorIdx > 0) cursorIdx--;
        continue;
      }
      if (key === "\x1b[B" || key === "j") {
        if (cursorIdx < selectableIndices.length - 1) cursorIdx++;
        continue;
      }
      if (key !== "\r" && key !== "\n") {
        continue;
      }

      const selected = items[cursor] as SelectChoice<Value>;
      lastSelected = selected.value;
      const result = await options.onSelect(selected.value, data, state);
      if (result == null) {
        break;
      }

      if (typeof result === "object" && "state" in result) {
        state = result.state;
        if (result.close) {
          process.stdout.write("\x1b[?25h");
          return state;
        }
      } else {
        state = result;
      }
      break;
    }
  }
}
