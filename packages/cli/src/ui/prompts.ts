import { select, input, confirm, password } from "@inquirer/prompts";
import readline from "node:readline";

readline.emitKeypressEvents(process.stdin);

export function withEscape<T>(
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T | null> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;

    const settle = (value: T | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const onData = (buf: Buffer) => {
      if (buf.length === 1 && buf[0] === 0x1b) {
        controller.abort();
        settle(null);
      }
    };

    process.stdin.on("data", onData);

    fn(controller.signal)
      .then((v) => {
        process.stdin.off("data", onData);
        settle(v);
      })
      .catch(() => {
        process.stdin.off("data", onData);
        settle(null);
      });
  });
}

export async function selectAction<T extends string>(
  message: string,
  choices: { name: string; value: T }[]
): Promise<T> {
  const result = await withEscape((signal) =>
    (select as any)({ message, choices }, { signal })
  );
  return (result ?? "__back__") as T;
}

export async function inputPrompt(message: string): Promise<string> {
  return input({ message });
}

export async function passwordPrompt(message: string): Promise<string> {
  return password({ message });
}

export async function confirmPrompt(message: string): Promise<boolean> {
  return confirm({ message });
}

export async function numberPrompt(message: string): Promise<number> {
  const val = await input({ message });
  return parseInt(val, 10);
}
