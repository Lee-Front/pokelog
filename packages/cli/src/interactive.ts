import { input } from "@inquirer/prompts";
import { statusCommand } from "./commands/status.js";
import { eventsCommand } from "./commands/events.js";
import { partyCommand } from "./commands/party.js";
import { storageCommand } from "./commands/storage.js";
import { healCommand } from "./commands/heal.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { inventoryCommand } from "./commands/inventory.js";
import { shopCommand } from "./commands/shop.js";
import { rankingCommand } from "./commands/ranking.js";
import { nicknameCommand } from "./commands/profile.js";
import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { debugCommand } from "./commands/debug.js";
import { joinCommand } from "./commands/join.js";
import { serversCommand } from "./commands/servers.js";
import { useCommand } from "./commands/use.js";
import { leaveCommand } from "./commands/leave.js";
import { hasNoServers, getCurrentServerName, getCurrentServer, getToken, clearToken } from "./config.js";
import { printHeader } from "./ui/display.js";

// Alternate Screen Buffer
function enterAltScreen() {
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[2J\x1b[H");
}

function leaveAltScreen() {
  process.stdout.write("\x1b[?1049l");
}

export function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

async function printBanner() {
  const { fetchArt } = await import("./ui/display.js");
  const art = await fetchArt("ho-oh");
  if (art) console.log(art);

  const G = "\x1b[1m\x1b[38;2;218;165;32m";
  const R = "\x1b[0m";
  console.log(`${G}  ██████╗  ██████╗ ██╗  ██╗███████╗██╗      ██████╗  ██████╗ ${R}`);
  console.log(`${G}  ██╔══██╗██╔═══██╗██║ ██╔╝██╔════╝██║     ██╔═══██╗██╔════╝ ${R}`);
  console.log(`${G}  ██████╔╝██║   ██║█████╔╝ █████╗  ██║     ██║   ██║██║  ███╗${R}`);
  console.log(`${G}  ██╔═══╝ ██║   ██║██╔═██╗ ██╔══╝  ██║     ██║   ██║██║   ██║${R}`);
  console.log(`${G}  ██║     ╚██████╔╝██║  ██╗███████╗███████╗╚██████╔╝╚██████╔╝${R}`);
  console.log(`${G}  ╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝  ╚═════╝ ${R}`);
  console.log();
}

const HELP_PAGES: Record<string, Array<{ cmd: string; desc: string }>> = {
  "게임": [
    { cmd: "encounters",          desc: "야생 조우" },
    { cmd: "party",               desc: "파티 확인" },
    { cmd: "pokedex",             desc: "도감" },
    { cmd: "inventory",           desc: "인벤토리" },
    { cmd: "heal",                desc: "치료센터 (파티 전체 회복)" },
    { cmd: "shop",                desc: "상점" },
    { cmd: "storage",             desc: "보관함" },
    { cmd: "ranking",             desc: "랭킹" },
  ],
  "서버 관리": [
    { cmd: "join <url>",   desc: "서버에 참가" },
    { cmd: "servers",      desc: "서버 목록 / 전환" },
    { cmd: "leave",        desc: "서버에서 나가기" },
  ],
  "계정": [
    { cmd: "nickname",  desc: "닉네임 변경" },
    { cmd: "login",     desc: "로그인" },
    { cmd: "logout",    desc: "로그아웃" },
    { cmd: "register",  desc: "회원가입" },
  ],
  "기타": [
    { cmd: "clear", desc: "화면 지우기" },
    { cmd: "help",  desc: "도움말" },
    { cmd: "quit",  desc: "종료" },
  ],
};

async function printHelp() {
  const { rawSelect, separator } = await import("./ui/prompts.js");
  const DIM = "\x1b[90m";
  const R = "\x1b[0m";

  const items: Array<{ name: string; value: string } | { separator: string }> = [];

  for (const [category, entries] of Object.entries(HELP_PAGES)) {
    items.push(separator(`\x1b[33m  ── ${category} ──\x1b[0m`));
    for (const { cmd, desc } of entries) {
      const needsArgs = cmd.includes("<");
      const cmdPart = cmd.padEnd(24);
      const name = needsArgs
        ? `  ${DIM}${cmdPart}${desc}${R}`
        : `  ${cmdPart}${DIM}${desc}${R}`;
      items.push({ name, value: cmd });
    }
  }
  items.push(separator(" "));
  items.push({ name: "← 닫기", value: "__close__" });

  let lastValue: string | undefined;
  while (true) {
    const result = await rawSelect("명령어 목록  ↑↓ 스크롤  Esc 닫기", items, {
      pageSize: 16,
      default: lastValue,
    });

    if (!result || result === "__close__") return;

    const baseCmd = result.split(/[\s<]/)[0];
    const needsArgs = result.includes("<");

    if (needsArgs || baseCmd === "help") {
      lastValue = result;
      continue;
    }

    await executeCommand(baseCmd);
    return;
  }
}

function resolveCommand(input: string): string | { ambiguous: string[] } {
  if (ALL_COMMANDS.includes(input)) return input;
  const matches = ALL_COMMANDS.filter((c) => c.startsWith(input));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: matches };
  return input;
}

async function executeCommand(line: string): Promise<boolean> {
  const parts = line.trim().split(/\s+/);
  const resolved = resolveCommand(parts[0]);
  if (typeof resolved === "object") {
    console.log(`  후보: ${resolved.ambiguous.join(", ")}`);
    return true;
  }
  const cmd = resolved;
  const args = parts.slice(1);

  if (!cmd) return true;

  clearScreen();
  await printHeader(cmd);

  switch (cmd) {
    // 서버 관리
    case "join":
      if (args[0]) await joinCommand(args[0]);
      else console.log("사용법: join <url>");
      break;
    case "servers":
      await serversCommand();
      break;
    case "use":
      if (args[0]) await useCommand(args[0]);
      else await serversCommand();
      break;
    case "leave":
      await leaveCommand();
      break;

    // 게임
    case "status":
      await statusCommand();
      break;
    case "encounters":
      await eventsCommand();
      break;
    case "party":
      await partyCommand();
      break;
    case "pokedex":
      await pokedexCommand();
      break;
    case "inventory":
      await inventoryCommand();
      break;
    case "shop":
      await shopCommand();
      break;
    case "heal":
      await healCommand();
      break;
    case "storage":
      await storageCommand();
      break;
    case "ranking":
      await rankingCommand(args[0] || "exp");
      break;
    case "nickname":
      await nicknameCommand(args[0]);
      break;
    case "login":
      await loginCommand();
      break;
    case "logout":
      await logoutCommand();
      break;
    case "register":
      await registerCommand();
      break;
    case "debug":
      await debugCommand();
      break;
    case "help":
      await printHelp();
      break;
    case "quit":
    case "exit":
      console.log("다음에 또 만나요!");
      return false;
    default:
      console.log(`알 수 없는 명령어: ${cmd} (help로 명령어 목록 확인)`);
  }

  // 명령 실행 후 화면 정리 + 헤더 복원
  if (cmd !== "quit" && cmd !== "exit") {
    clearScreen();
    await printHeader(null);
  }

  return true;
}

async function getPrompt(): Promise<string> {
  const name = await getCurrentServerName();
  if (name) {
    return `\x1b[36mpokelog\x1b[0m[\x1b[33m${name}\x1b[0m]> `;
  }
  return "\x1b[36mpokelog\x1b[0m> ";
}

function printWelcomeGuide() {
  const DIM = "\x1b[90m";
  const R = "\x1b[0m";
  console.log(`${DIM}  login으로 로그인하거나 register로 회원가입하세요.${R}\n`);
}

async function printServerGuide(): Promise<boolean> {
  const noServers = await hasNoServers();
  if (noServers) {
    console.log("\x1b[33m  참가한 서버가 없습니다.\x1b[0m\n");
    console.log("  서버에 참가하세요:");
    console.log("    join <url>\n");
    return false;
  }

  const server = await getCurrentServer();
  if (!server) {
    console.log("\x1b[33m  활성 서버가 없습니다.\x1b[0m\n");
    console.log("  서버를 선택하세요:");
    console.log("    servers → use <name>\n");
    return false;
  }
  return true;
}

// 로그인 필요한 명령어
const AUTH_COMMANDS = new Set([
  "encounters", "party", "pokedex",
  "inventory", "heal", "shop", "storage",
  "ranking", "nickname", "logout", "debug",
]);

const ALL_COMMANDS = [
  "encounters", "party", "pokedex",
  "inventory", "heal", "shop", "storage", "ranking",
  "join", "servers", "use", "leave",
  "nickname", "login", "logout", "register",
  "debug", "clear", "help", "quit", "exit",
];

export async function interactiveMode() {
  enterAltScreen();
  await printBanner();

  const serverReady = await printServerGuide();
  if (serverReady) {
    const token = await getToken();
    if (!token) {
      printWelcomeGuide();
    }
  }

  const cleanup = () => leaveAltScreen();
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  let loggedIn = !!(await getToken());

  while (true) {
    const promptStr = await getPrompt();
    let line: string;
    try {
      line = await input({ message: promptStr });
    } catch {
      break;
    }
    if (!line) continue;

    // 명령어 축약 해석
    const parts = line.trim().split(/\s+/);
    const resolved = resolveCommand(parts[0]);
    const cmd = typeof resolved === "string" ? resolved : parts[0];

    // 로그인 필요한 명령어 체크
    if (!loggedIn && AUTH_COMMANDS.has(cmd)) {
      console.log("\x1b[33m  로그인이 필요합니다. login 또는 register를 입력하세요.\x1b[0m\n");
      continue;
    }

    try {
      const shouldContinue = await executeCommand(line);
      if (!shouldContinue) {
        leaveAltScreen();
        return;
      }

      // login/register 성공 후 상태 갱신
      if (cmd === "login" || cmd === "register") {
        const token = await getToken();
        if (token && !loggedIn) {
          loggedIn = true;
          clearScreen();
          await printHeader(null);
          console.log(`\x1b[90m  help를 입력하면 명령어 목록을 볼 수 있습니다.\x1b[0m\n`);
        }
      }
      // logout 후 상태 갱신
      if (cmd === "logout") {
        loggedIn = false;
      }
    } catch (err) {
      console.error("오류:", err);
    }

    // 로그인 전이면 타이틀 복귀 (서버/인증 명령 제외)
    const NO_BANNER_CMDS = new Set(["servers", "server", "join", "use", "leave", "whereami", "login", "register", "help"]);
    if (!loggedIn && !NO_BANNER_CMDS.has(cmd)) {
      clearScreen();
      await printBanner();
      printWelcomeGuide();
    }
  }
}
