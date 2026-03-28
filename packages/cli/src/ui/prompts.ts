import { stripAnsi } from "./display.js";

// ── 자체 raw-mode UI (inquirer abort가 stdin에 EOF를 push하여 영구 차단하므로 직접 구현) ──

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

function enterRaw() {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

function leaveRaw() {
  // raw mode / pause는 건드리지 않음 — 메인 루프 input()이 관리
}

function waitKey(): Promise<string> {
  return new Promise((resolve) => {
    const handler = (chunk: string) => {
      process.stdin.removeListener("data", handler);
      resolve(chunk);
    };
    process.stdin.once("data", handler);
  });
}

/**
 * Esc로 취소 가능한 select 메뉴 (inquirer 미사용)
 * @returns 선택된 값 또는 null (Esc)
 */
export async function rawSelect<T>(
  message: string,
  items: SelectItem<T>[],
  opts?: { pageSize?: number; default?: T },
): Promise<T | null> {
  enterRaw();
  process.stdout.write("\x1b[?25l"); // 커서 숨기기

  const pageSize = opts?.pageSize ?? 12;
  const selectableIndices = items
    .map((item, i) => (!isSeparator(item) && !item.disabled ? i : -1))
    .filter((i) => i >= 0);

  if (selectableIndices.length === 0) {
    process.stdout.write("\x1b[?25h");
    leaveRaw();
    return null;
  }

  // 기본값으로 초기 커서 위치 설정
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

    // 스크롤 조정
    if (cursor < scroll) scroll = cursor;
    if (cursor >= scroll + pageSize) scroll = cursor - pageSize + 1;

    // 화면 그리기
    const lines: string[] = [];
    const DIM = "\x1b[90m";
    const CYN = "\x1b[36m";
    const R = "\x1b[0m";

    lines.push(`${DIM}?${R} ${message}`);

    const end = Math.min(scroll + pageSize, items.length);
    for (let i = scroll; i < end; i++) {
      const item = items[i];
      if (isSeparator(item)) {
        lines.push(item.separator);
      } else if (item.disabled) {
        lines.push(`  ${DIM}${stripAnsi(item.name)}${R}`);
      } else {
        const active = i === cursor;
        if (active) {
          lines.push(`${CYN}❯${R} ${item.name}`);
        } else {
          lines.push(`  ${item.name}`);
        }
      }
    }

    // 렌더링
    let out = "";
    if (lineCount > 0) out += `\x1b[${lineCount}A`;
    for (const line of lines) {
      out += `\r${line}\x1b[K\n`;
    }
    // 이전보다 줄이 줄었으면 남은 줄 지우기
    if (lines.length < lineCount) {
      const extra = lineCount - lines.length;
      for (let i = 0; i < extra; i++) out += "\r\x1b[K\n";
      out += `\x1b[${extra}A`;
    }
    process.stdout.write(out);
    lineCount = lines.length;

    // 키 입력 대기
    const key = await waitKey();

    if (key === "\x03") { // Ctrl+C
      process.stdout.write("\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b" || key === "q") { // Esc 또는 q
      process.stdout.write("\x1b[?25h");
      leaveRaw();
      return null;
    }
    if (key === "\r" || key === "\n") { // Enter
      process.stdout.write("\x1b[?25h");
      leaveRaw();
      const selected = items[cursor] as SelectChoice<T>;
      return selected.value;
    }
    if (key === "\x1b[A" || key === "k") { // Up
      if (cursorIdx > 0) cursorIdx--;
    }
    if (key === "\x1b[B" || key === "j") { // Down
      if (cursorIdx < selectableIndices.length - 1) cursorIdx++;
    }
  }
}

/**
 * Separator 생성 헬퍼
 */
export function separator(text: string): SeparatorItem {
  return { separator: text };
}

/**
 * Esc로 취소 가능한 텍스트 입력 (inquirer 미사용)
 * @returns 입력된 문자열 또는 null (Esc)
 */
export async function rawInput(prompt: string): Promise<string | null> {
  enterRaw();
  process.stdout.write(`\x1b[90m?\x1b[0m ${prompt}`);

  let buf = "";
  while (true) {
    const key = await waitKey();

    if (key === "\x03") { // Ctrl+C
      process.stdout.write("\n\x1b[?25h");
      process.exit(0);
    }
    if (key === "\x1b") { // Esc
      process.stdout.write("\n");
      leaveRaw();
      return null;
    }
    if (key === "\r" || key === "\n") { // Enter
      process.stdout.write("\n");
      leaveRaw();
      return buf;
    }
    if (key === "\x7f" || key === "\b") { // Backspace
      if (buf.length > 0) {
        buf = buf.slice(0, -1);
        process.stdout.write("\b \b");
      }
      continue;
    }
    // 일반 문자 (제어 문자 무시)
    if (key.length === 1 && key.charCodeAt(0) >= 32) {
      buf += key;
      process.stdout.write(key);
    }
  }
}

/**
 * Esc로 취소 가능한 비밀번호 입력 (마스킹)
 */
export async function rawPassword(prompt: string): Promise<string | null> {
  enterRaw();
  process.stdout.write(`\x1b[90m?\x1b[0m ${prompt}`);

  let buf = "";
  while (true) {
    const key = await waitKey();

    if (key === "\x03") { process.stdout.write("\n\x1b[?25h"); process.exit(0); }
    if (key === "\x1b") { process.stdout.write("\n"); leaveRaw(); return null; }
    if (key === "\r" || key === "\n") { process.stdout.write("\n"); leaveRaw(); return buf; }
    if (key === "\x7f" || key === "\b") {
      if (buf.length > 0) {
        buf = buf.slice(0, -1);
        process.stdout.write("\b \b");
      }
      continue;
    }
    if (key.length === 1 && key.charCodeAt(0) >= 32) {
      buf += key;
      process.stdout.write("*");
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
