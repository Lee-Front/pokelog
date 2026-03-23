import readline from "node:readline";
import { statusCommand } from "./commands/status.js";
import { eventsCommand } from "./commands/events.js";
import { partyCommand } from "./commands/party.js";
import { storageCommand } from "./commands/storage.js";
import { pokemonCommand } from "./commands/pokemon.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { inventoryCommand } from "./commands/inventory.js";
import { shopCommand, buyCommand } from "./commands/shop.js";
import { rankingCommand } from "./commands/ranking.js";
import { profileCommand, nicknameCommand, matchCommand, unmatchCommand } from "./commands/profile.js";
import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { encounterCommand } from "./commands/encounter.js";
import { useItemCommand } from "./commands/use-item.js";
import { withdrawCommand, depositCommand } from "./commands/storage.js";
import { initCommand } from "./commands/init.js";

// Alternate Screen Buffer — 별도 화면 버퍼 사용 (vim, htop 방식)
function enterAltScreen() {
  process.stdout.write("\x1b[?1049h"); // 대체 화면 진입
  process.stdout.write("\x1b[2J\x1b[H"); // 클리어 + 커서 홈
}

function leaveAltScreen() {
  process.stdout.write("\x1b[?1049l"); // 원래 화면 복귀
}

export function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function printBanner() {
  console.log("\x1b[33m");
  console.log("  ╔═══════════════════════════════════╗");
  console.log("  ║         P O K E L O G             ║");
  console.log("  ║   커밋으로 포켓몬을 키우자!        ║");
  console.log("  ╚═══════════════════════════════════╝");
  console.log("\x1b[0m");
  console.log("  help를 입력하면 명령어 목록을 볼 수 있습니다.\n");
}

function printHelp() {
  console.log(`
  사용 가능한 명령어:
  ──────────────────────────────
  status              현황 요약
  events              미확인 이벤트
  encounter <id>      야생 조우 진입
  party               파티 확인
  pokedex             도감
  inventory           인벤토리
  shop                상점
  buy <item> [qty]    아이템 구매
  use <item> <uid>    아이템 사용
  storage             보관함
  withdraw <uid>      보관함 → 파티
  deposit <uid>       파티 → 보관함
  pokemon <uid>       포켓몬 상세
  ranking             랭킹
  profile [nickname]  프로필
  nickname <name>     닉네임 변경
  match <app> <id>    매칭 추가
  unmatch <app> <id>  매칭 제거
  login               로그인
  logout              로그아웃
  register            회원가입
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
    case "use":
      if (args[0] && args[1]) await useItemCommand(args[0], args[1]);
      else console.log("사용법: use <item> <pokemonUid>");
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
    case "init":
      if (args[0]) await initCommand(args[0]);
      else console.log("사용법: init <serverUrl>");
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

export async function interactiveMode() {
  enterAltScreen();
  printBanner();

  // 종료 시 원래 화면 복귀
  const cleanup = () => leaveAltScreen();
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36mpokelog>\x1b[0m ",
  });

  rl.prompt();

  for await (const line of rl) {
    try {
      const shouldContinue = await executeCommand(line);
      if (!shouldContinue) {
        rl.close();
        leaveAltScreen();
        return;
      }
    } catch (err) {
      console.error("오류:", err);
    }
    console.log();
    rl.prompt();
  }
}
