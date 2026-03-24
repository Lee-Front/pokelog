import readline from "node:readline";
import { statusCommand } from "./commands/status.js";
import { eventsCommand } from "./commands/events.js";
import { partyCommand } from "./commands/party.js";
import { storageCommand, withdrawCommand, depositCommand } from "./commands/storage.js";
import { pokemonCommand } from "./commands/pokemon.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { inventoryCommand } from "./commands/inventory.js";
import { shopCommand, buyCommand } from "./commands/shop.js";
import { rankingCommand } from "./commands/ranking.js";
import { profileCommand, nicknameCommand, matchCommand, unmatchCommand } from "./commands/profile.js";
import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { encounterCommand } from "./commands/encounter.js";
import { useItemCommand } from "./commands/use-item.js";
import { joinCommand } from "./commands/join.js";
import { serversCommand } from "./commands/servers.js";
import { useCommand } from "./commands/use.js";
import { leaveCommand } from "./commands/leave.js";
import { whereamiCommand } from "./commands/whereami.js";
import { hasNoServers, getCurrentServerName, getCurrentServer, getToken } from "./config.js";

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
  console.log(`\x1b[90m  help를 입력하면 명령어 목록을 볼 수 있습니다.\x1b[0m\n`);
}

function printHelp() {
  console.log(`
  서버 관리:
  ──────────────────────────────
  join <url>          서버에 참가
  servers             참가한 서버 목록
  use <name>          서버 전환
  leave <name>        서버에서 나가기
  whereami            현재 서버 정보

  게임:
  ──────────────────────────────
  status              현황 요약
  events              미확인 이벤트
  encounter <id>      야생 조우 진입
  party               파티 확인
  pokedex             도감
  inventory           인벤토리
  shop                상점
  buy <item> [qty]    아이템 구매
  use-item <item> <uid>  아이템 사용
  storage             보관함
  withdraw <uid>      보관함 → 파티
  deposit <uid>       파티 → 보관함
  pokemon <uid>       포켓몬 상세
  ranking             랭킹

  계정:
  ──────────────────────────────
  profile [nickname]  프로필
  nickname <name>     닉네임 변경
  match <app> <id>    매칭 추가
  unmatch <app> <id>  매칭 제거
  login               로그인
  logout              로그아웃
  register            회원가입

  기타:
  ──────────────────────────────
  clear               화면 지우기
  help                도움말
  quit                종료
  `);
}

async function executeCommand(line: string): Promise<boolean> {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  if (!cmd) return true;

  clearScreen();

  switch (cmd) {
    // 서버 관리
    case "join":
      if (args[0]) await joinCommand(args[0]);
      else console.log("사용법: join <url>");
      break;
    case "servers":
      await serversCommand();
      break;
    case "server":
      await whereamiCommand();
      break;
    case "use":
      if (args[0]) await useCommand(args[0]);
      else console.log("사용법: use <name>");
      break;
    case "leave":
      if (args[0]) await leaveCommand(args[0]);
      else console.log("사용법: leave <name>");
      break;
    case "whereami":
      await whereamiCommand();
      break;

    // 게임
    case "status":
      await statusCommand();
      break;
    case "events":
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
    case "storage":
      await storageCommand();
      break;
    case "ranking":
      await rankingCommand(args[0] || "exp");
      break;
    case "profile":
      await profileCommand(args[0]);
      break;
    case "encounter":
      if (args[0]) await encounterCommand(args[0]);
      else console.log("사용법: encounter <eventId>");
      break;
    case "pokemon":
      if (args[0]) await pokemonCommand(args[0]);
      else console.log("사용법: pokemon <uid>");
      break;
    case "nickname":
      if (args[0]) await nicknameCommand(args[0]);
      else console.log("사용법: nickname <name>");
      break;
    case "match":
      if (args[0] && args[1]) await matchCommand(args[0], args[1]);
      else console.log("사용법: match <app> <identifier>");
      break;
    case "unmatch":
      if (args[0] && args[1]) await unmatchCommand(args[0], args[1]);
      else console.log("사용법: unmatch <app> <identifier>");
      break;
    case "buy":
      if (args[0]) await buyCommand(args[0], parseInt(args[1] || "1", 10));
      else console.log("사용법: buy <item> [quantity]");
      break;
    case "use-item":
      if (args[0] && args[1]) await useItemCommand(args[0], args[1]);
      else console.log("사용법: use-item <item> <pokemonUid>");
      break;
    case "withdraw":
      if (args[0]) await withdrawCommand(args[0]);
      else console.log("사용법: withdraw <uid>");
      break;
    case "deposit":
      if (args[0]) await depositCommand(args[0]);
      else console.log("사용법: deposit <uid>");
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
    case "clear":
      clearScreen();
      break;
    case "help":
      printHelp();
      break;
    case "quit":
    case "exit":
      console.log("다음에 또 만나요!");
      return false;
    default:
      console.log(`알 수 없는 명령어: ${cmd} (help로 명령어 목록 확인)`);
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

async function showFirstRunUx(): Promise<void> {
  const noServers = await hasNoServers();
  if (noServers) {
    console.log("\x1b[33m  참가한 서버가 없습니다.\x1b[0m\n");
    console.log("  서버에 참가하세요:");
    console.log("    join <url>\n");
    return;
  }

  const server = await getCurrentServer();
  if (!server) {
    console.log("\x1b[33m  활성 서버가 없습니다.\x1b[0m\n");
    console.log("  서버를 선택하세요:");
    console.log("    servers → use <name>\n");
    return;
  }

  const token = await getToken();
  if (!token) {
    console.log(`  서버: \x1b[33m${server.displayName}\x1b[0m (${server.name})\n`);
    console.log("  로그인 또는 회원가입이 필요합니다:");
    console.log("    login");
    console.log("    register\n");
    return;
  }
}

export async function interactiveMode() {
  enterAltScreen();
  await printBanner();
  await showFirstRunUx();

  const cleanup = () => leaveAltScreen();
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  function promptOnce(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(prompt, (answer) => {
        if (!resolved) {
          resolved = true;
          rl.close();
          resolve(answer);
        }
      });
      rl.once("close", () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });
    });
  }

  while (true) {
    const prompt = await getPrompt();
    const line = await promptOnce(prompt);
    if (line === null) break;

    try {
      const shouldContinue = await executeCommand(line);
      if (!shouldContinue) {
        leaveAltScreen();
        return;
      }
    } catch (err) {
      console.error("오류:", err);
    }

    console.log();
  }
}
