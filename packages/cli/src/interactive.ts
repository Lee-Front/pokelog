import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { connectCommand } from "./commands/connect.js";
import { debugCommand } from "./commands/debug.js";
import { eggCommand } from "./commands/egg.js";
import { encounterCommand } from "./commands/encounter.js";
import { evolutionsCommand } from "./commands/evolutions.js";
import { eventsCommand } from "./commands/events.js";
import { healCommand } from "./commands/heal.js";
import { historyCommand } from "./commands/history.js";
import { inventoryCommand } from "./commands/inventory.js";
import { joinCommand } from "./commands/join.js";
import { leaveCommand } from "./commands/leave.js";
import { nicknameCommand } from "./commands/profile.js";
import { partyCommand } from "./commands/party.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { rankingCommand } from "./commands/ranking.js";
import { regionCommand } from "./commands/region.js";
import { serversCommand } from "./commands/servers.js";
import { shopCommand } from "./commands/shop.js";
import { statusCommand } from "./commands/status.js";
import { storageCommand } from "./commands/storage.js";
import { tradeCommand } from "./commands/trade.js";
import { useCommand } from "./commands/use.js";
import { getCurrentServer, getCurrentServerName, getToken, hasNoServers } from "./config.js";
import { BLD, CYN, R } from "./ui/colors.js";
import { separator } from "./ui/prompts.js";
import { clearScreen, enterAltScreen, inputFrame, leaveAltScreen, resetScreen, selectFrame } from "./ui/screen.js";

async function printBanner() {
  const { fetchArt } = await import("./ui/display.js");
  const art = await fetchArt("ho-oh");
  if (art) console.log(art);
  console.log();
}

const HELP_PAGES: Record<string, Array<{ cmd: string; desc: string }>> = {
  Game: [
    { cmd: "status", desc: "현재 상태 보기" },
    { cmd: "encounters", desc: "야생 이벤트 보기" },
    { cmd: "party", desc: "파티 보기" },
    { cmd: "pokedex", desc: "도감 보기" },
    { cmd: "inventory", desc: "인벤토리 보기" },
    { cmd: "heal", desc: "파티 회복" },
    { cmd: "egg", desc: "알 구매 / 부화" },
    { cmd: "shop", desc: "상점 열기" },
    { cmd: "storage", desc: "보관함 보기" },
    { cmd: "ranking", desc: "랭킹 보기" },
    { cmd: "history", desc: "소스별 적립 이력 보기" },
  ],
  Server: [
    { cmd: "join <url>", desc: "서버 참가" },
    { cmd: "servers", desc: "서버 목록 보기" },
    { cmd: "use <name>", desc: "서버 전환" },
    { cmd: "leave", desc: "현재 서버 나가기" },
  ],
  Account: [
    { cmd: "register", desc: "회원가입" },
    { cmd: "login", desc: "로그인" },
    { cmd: "logout", desc: "로그아웃" },
    { cmd: "nickname", desc: "닉네임 변경" },
    { cmd: "connect", desc: "연동 관리" },
    { cmd: "debug", desc: "디버그 메뉴" },
  ],
  System: [
    { cmd: "help", desc: "도움말 보기" },
    { cmd: "quit", desc: "종료" },
  ],
};

async function printHelp() {
  const items: Array<{ name: string; value: string } | { separator: string }> = [];
  for (const [category, entries] of Object.entries(HELP_PAGES)) {
    items.push(separator(`  ${BLD}${CYN}── ${category} ──${R}`));
    for (const { cmd, desc } of entries) {
      items.push({ name: `${cmd.padEnd(20)} ${desc}`, value: cmd });
    }
  }
  items.push(separator(" "));
  items.push({ name: "닫기", value: "__close__" });

  while (true) {
    const result = await selectFrame("명령 도움말", items, { pageSize: 18 });
    if (!result || result === "__close__") return;
    const baseCmd = result.split(/[\s<]/)[0];
    if (baseCmd === "help") continue;
    await executeCommand(baseCmd);
    return;
  }
}

const AUTH_COMMANDS = new Set([
  "status",
  "encounters",
  "party",
  "pokedex",
  "inventory",
  "trade",
  "region",
  "evolutions",
  "heal",
  "egg",
  "shop",
  "storage",
  "ranking",
  "history",
  "nickname",
  "logout",
  "debug",
  "connect",
]);

const ALL_COMMANDS = [
  "status",
  "encounters",
  "party",
  "pokedex",
  "inventory",
  "trade",
  "region",
  "evolutions",
  "heal",
  "egg",
  "shop",
  "storage",
  "ranking",
  "history",
  "join",
  "servers",
  "use",
  "leave",
  "nickname",
  "login",
  "logout",
  "register",
  "connect",
  "debug",
  "help",
  "quit",
  "exit",
];

function resolveCommand(input: string): string | { ambiguous: string[] } {
  if (ALL_COMMANDS.includes(input)) return input;
  const matches = ALL_COMMANDS.filter((cmd) => cmd.startsWith(input));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { ambiguous: matches };
  return input;
}

async function executeCommand(line: string): Promise<boolean> {
  const parts = line.trim().split(/\s+/);
  const resolved = resolveCommand(parts[0] ?? "");
  if (typeof resolved === "object") {
    console.log(`  모호한 명령입니다: ${resolved.ambiguous.join(", ")}`);
    return true;
  }

  const cmd = resolved;
  const args = parts.slice(1);
  if (!cmd) return true;

  await resetScreen(cmd);
  let preserveOutput = false;

  switch (cmd) {
    case "join":
      if (args[0]) await joinCommand(args[0]);
      else console.log("사용법: join <url>");
      break;
    case "servers":
      await serversCommand();
      break;
    case "use":
      if (args[0]) await useCommand(args[0]);
      else console.log("사용법: use <name>");
      break;
    case "leave":
      await leaveCommand();
      break;
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
    case "trade":
      await tradeCommand();
      break;
    case "region":
      await regionCommand(args[0]);
      break;
    case "evolutions":
      await evolutionsCommand();
      break;
    case "heal":
      await healCommand();
      break;
    case "egg":
      await eggCommand();
      break;
    case "shop":
      await shopCommand();
      break;
    case "storage":
      await storageCommand();
      break;
    case "ranking":
      await rankingCommand(args[0] || "exp");
      break;
    case "history":
      await historyCommand();
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
    case "connect":
      await connectCommand();
      break;
    case "debug":
      await debugCommand();
      break;
    case "help":
      await printHelp();
      break;
    case "quit":
    case "exit":
      leaveAltScreen();
      return false;
    default:
      console.log(`알 수 없는 명령입니다: ${cmd}`);
      break;
  }

  if (cmd !== "quit" && cmd !== "exit" && !preserveOutput) {
    await resetScreen(null);
  }

  return true;
}

async function getPrompt(): Promise<string> {
  const name = await getCurrentServerName();
  return name ? `pokelog[${name}]> ` : "pokelog> ";
}

function printWelcomeGuide() {
  console.log("  login 또는 register 후 게임 명령을 사용할 수 있습니다.\n");
}

async function printServerGuide(): Promise<boolean> {
  const noServers = await hasNoServers();
  if (noServers) {
    console.log("  서버가 없습니다.\n");
    console.log("  join <url> 로 서버에 먼저 연결하세요.\n");
    return false;
  }

  const server = await getCurrentServer();
  if (!server) {
    console.log("  현재 선택된 서버가 없습니다.\n");
    console.log("  servers 또는 use <name> 으로 서버를 선택하세요.\n");
    return false;
  }
  return true;
}

export async function interactiveMode() {
  enterAltScreen();
  await printBanner();

  const serverReady = await printServerGuide();
  if (serverReady && !(await getToken())) {
    printWelcomeGuide();
  }

  const cleanup = () => leaveAltScreen();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  let loggedIn = !!(await getToken());

  while (true) {
    const prompt = await getPrompt();
    const line = (await inputFrame(prompt, { preserveFrame: true })) ?? "";
    if (!line.trim()) continue;

    const parts = line.trim().split(/\s+/);
    const resolved = resolveCommand(parts[0] ?? "");
    const cmd = typeof resolved === "string" ? resolved : parts[0];

    if (!loggedIn && AUTH_COMMANDS.has(cmd)) {
      console.log("  로그인 후 사용할 수 있는 명령입니다.\n");
      continue;
    }

    try {
      const shouldContinue = await executeCommand(line);
      if (!shouldContinue) return;

      if (cmd === "login" || cmd === "register") {
        loggedIn = !!(await getToken());
      }
      if (cmd === "logout") {
        loggedIn = false;
      }
    } catch (error) {
      console.error("오류:", error);
    }

    if (!loggedIn && !["servers", "join", "use", "leave", "help"].includes(cmd)) {
      clearScreen();
      await printBanner();
      printWelcomeGuide();
    }
  }
}
