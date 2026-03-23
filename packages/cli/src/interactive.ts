import readline from "node:readline";
import { select } from "@inquirer/prompts";
import { statusCommand } from "./commands/status.js";
import { eventsCommand } from "./commands/events.js";
import { partyCommand } from "./commands/party.js";
import { storageCommand } from "./commands/storage.js";
import { pokemonCommand } from "./commands/pokemon.js";
import { pokedexCommand } from "./commands/pokedex.js";
import { inventoryCommand } from "./commands/inventory.js";
import { shopCommand } from "./commands/shop.js";
import { rankingCommand } from "./commands/ranking.js";
import { profileCommand, nicknameCommand, matchCommand, unmatchCommand } from "./commands/profile.js";
import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { encounterCommand } from "./commands/encounter.js";
import { buyCommand } from "./commands/shop.js";
import { useItemCommand } from "./commands/use-item.js";
import { withdrawCommand, depositCommand } from "./commands/storage.js";
import { initCommand } from "./commands/init.js";

const MENU_CHOICES = [
  { name: "현황 보기          (status)", value: "status" },
  { name: "이벤트 확인        (events)", value: "events" },
  { name: "파티               (party)", value: "party" },
  { name: "도감               (pokedex)", value: "pokedex" },
  { name: "인벤토리           (inventory)", value: "inventory" },
  { name: "상점               (shop)", value: "shop" },
  { name: "보관함             (storage)", value: "storage" },
  { name: "랭킹               (ranking)", value: "ranking" },
  { name: "내 프로필           (profile)", value: "profile" },
  { name: "─────────────────────", value: "__sep__" },
  { name: "명령어 직접 입력", value: "__input__" },
  { name: "종료               (quit)", value: "quit" },
];

const COMMAND_MAP: Record<string, (...args: string[]) => Promise<void>> = {
  status: statusCommand,
  events: eventsCommand,
  party: partyCommand,
  pokedex: pokedexCommand,
  inventory: inventoryCommand,
  shop: shopCommand,
  storage: storageCommand,
  ranking: async () => rankingCommand("exp"),
  profile: async () => profileCommand(),
  login: loginCommand,
  logout: logoutCommand,
  register: registerCommand,
};

async function handleDirectInput(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const line = await new Promise<string>((resolve) => {
    rl.question("\x1b[36mpokelog>\x1b[0m ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!line || line === "quit" || line === "exit") return false;

  const parts = line.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);

  // 간단한 명령어 매핑
  const handler = COMMAND_MAP[cmd];
  if (handler) {
    await handler(...args);
    return true;
  }

  // 인자가 필요한 명령어들
  switch (cmd) {
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
    case "init":
      if (args[0]) await initCommand(args[0]);
      else console.log("사용법: init <serverUrl>");
      break;
    case "help":
      printHelp();
      break;
    default:
      console.log(`알 수 없는 명령어: ${cmd} (help로 명령어 목록 확인)`);
  }
  return true;
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
  help                도움말
  quit                종료
  `);
}

export async function interactiveMode() {
  console.log("\x1b[33m");
  console.log("  ╔═══════════════════════════════════╗");
  console.log("  ║         P O K E L O G             ║");
  console.log("  ║   커밋으로 포켓몬을 키우자!        ║");
  console.log("  ╚═══════════════════════════════════╝");
  console.log("\x1b[0m");

  let running = true;
  while (running) {
    try {
      const choice = await select({
        message: "무엇을 할까요?",
        choices: MENU_CHOICES,
      });

      if (choice === "__sep__") continue;
      if (choice === "quit") {
        console.log("다음에 또 만나요!");
        break;
      }
      if (choice === "__input__") {
        running = await handleDirectInput();
        continue;
      }

      const handler = COMMAND_MAP[choice];
      if (handler) {
        await handler();
      }
    } catch (err: unknown) {
      // Ctrl+C 처리
      if ((err as { name?: string })?.name === "ExitPromptError") {
        console.log("\n다음에 또 만나요!");
        break;
      }
      console.error(err);
    }

    console.log(); // 줄바꿈
  }
}
