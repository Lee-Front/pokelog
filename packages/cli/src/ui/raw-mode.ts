export function enterRaw(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
}

export function waitKey(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.once("data", (chunk: string) => resolve(chunk));
  });
}

export function handleCtrlC(key: string): void {
  if (key === "\x03") {
    process.stdout.write("\x1b[?25h");
    process.exit(0);
  }
}
