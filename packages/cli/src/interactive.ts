import { registerCommand, loginCommand, logoutCommand } from "./commands/auth.js";
import { connectCommand } from "./commands/connect.js";
import { debugCommand } from "./commands/debug.js";
import { eggCommand } from "./commands/egg.js";
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
import { getCurrentServer, getToken } from "./config.js";
import { BLD, CYN, DIM, GRN, R, RED, YEL } from "./ui/colors.js";
import { fetchArt, fetchHeaderData, invalidateHeaderCache } from "./ui/display.js";
import { enterRaw, waitKey } from "./ui/raw-mode.js";
import { enterAltScreen, leaveAltScreen, redraw, inputFrame, resetScreen } from "./ui/screen.js";
import { artToLines, padRight, visualWidth } from "./ui/text.js";

// ── 메뉴 정의 ───────────────────────────────────────────────────

type MenuLeaf = {
  label: string;
  cmd: string;
  desc: string;
  auth?: boolean;
  server?: boolean;
};

type MenuGroup = {
  label: string;
  desc: string;
  auth?: boolean;
  server?: boolean;
  children: MenuNode[];
};

type MenuNode = MenuLeaf | MenuGroup;

function isGroup(node: MenuNode): node is MenuGroup {
  return "children" in node;
}

const MENU_TREE: MenuNode[] = [
  { label: "야생",   cmd: "encounters", desc: "야생 이벤트",   auth: true, server: true },
  {
    label: "포켓몬", desc: "파티 / 보관함 / 도감", auth: true, server: true,
    children: [
      { label: "파티",   cmd: "party",   desc: "파티 보기" },
      { label: "보관함", cmd: "storage", desc: "보관함 보기" },
      { label: "도감",   cmd: "pokedex", desc: "도감 보기" },
    ],
  },
  { label: "가방",   cmd: "inventory", desc: "인벤토리",       auth: true, server: true },
  { label: "회복",   cmd: "heal",      desc: "파티 회복",      auth: true, server: true },
  {
    label: "상점", desc: "상점 / 알", auth: true, server: true,
    children: [
      { label: "상점", cmd: "shop", desc: "아이템 구매" },
      { label: "알",   cmd: "egg",  desc: "알 구매 / 부화" },
    ],
  },
  {
    label: "기록", desc: "상태 / 랭킹 / 이력", auth: true, server: true,
    children: [
      { label: "상태", cmd: "status",  desc: "현재 상태 보기" },
      { label: "랭킹", cmd: "ranking", desc: "랭킹 보기" },
      { label: "이력", cmd: "history", desc: "적립 이력 보기" },
    ],
  },
  {
    label: "서버", desc: "서버 관리",
    children: [
      { label: "서버 참가",   cmd: "join",    desc: "서버 참가" },
      { label: "서버 목록",   cmd: "servers", desc: "서버 목록 보기" },
      { label: "서버 나가기", cmd: "leave",   desc: "현재 서버 나가기", server: true },
    ],
  },
  {
    label: "계정", desc: "계정 관리",
    children: [
      { label: "회원가입", cmd: "register", desc: "회원가입" },
      { label: "로그인",   cmd: "login",    desc: "로그인" },
      { label: "로그아웃", cmd: "logout",   desc: "로그아웃",   auth: true },
      { label: "닉네임",   cmd: "nickname", desc: "닉네임 변경", auth: true },
      { label: "연동",     cmd: "connect",  desc: "연동 관리",   auth: true },
      { label: "디버그",   cmd: "debug",    desc: "디버그 메뉴", auth: true },
    ],
  },
  { label: "종료", cmd: "quit", desc: "프로그램 종료" },
];

// ── 메뉴 필터링 ─────────────────────────────────────────────────

function filterMenu(nodes: MenuNode[], loggedIn: boolean, hasServer: boolean): MenuNode[] {
  const result: MenuNode[] = [];
  for (const node of nodes) {
    if (node.auth && !loggedIn) continue;
    if (node.server && !hasServer) continue;
    if (isGroup(node)) {
      const children = filterMenu(node.children, loggedIn, hasServer);
      if (children.length > 0) {
        result.push({ ...node, children });
      }
    } else {
      result.push(node);
    }
  }
  return result;
}

// ── 스크롤 / 화면 ───────────────────────────────────────────────

const VISIBLE_ITEMS = 9;
const ART_GAP = "   ";

function buildHeaderLines(
  serverName: string,
  nickname: string,
  region: string,
  pendingEvents: number,
  points: number,
  leadPokemon: string | null,
  leadLevel: number,
  online: boolean,
): string[] {
  const status = online ? `${GRN}●${R}` : `${RED}● 오프라인${R}`;
  const line1 = `${DIM}server:${R} ${CYN}${serverName}${R} ${status}   ${DIM}trainer:${R} ${YEL}${nickname}${R}   ${DIM}location:${R} ${GRN}${region}${R}`;
  const line2 = online
    ? `${DIM}encounters:${R} ${pendingEvents}   ${DIM}points:${R} ${points}P   ${DIM}lead:${R} ${leadPokemon ? `${leadPokemon} Lv.${leadLevel}` : "-"}`
    : `${RED}서버에 연결할 수 없습니다.${R}`;
  return [`  ${line1}`, `  ${line2}`];
}

function buildMenuLines(
  items: MenuNode[],
  cursor: number,
  scroll: number,
  breadcrumb: string[],
  art: string | null,
  headerLines: string[],
  message: string,
): string[] {
  // 메뉴 라인 빌드
  const menuLines: string[] = [];

  // breadcrumb 표시
  if (breadcrumb.length > 0) {
    menuLines.push(`${DIM}${breadcrumb.join(" > ")}${R}`);
    menuLines.push("");
  }

  const end = Math.min(scroll + VISIBLE_ITEMS, items.length);
  if (scroll > 0) {
    menuLines.push(`  ${DIM}▲${R}`);
  }

  for (let i = scroll; i < end; i++) {
    const node = items[i];
    const active = i === cursor;
    const pointer = active ? `${YEL}>${R}` : " ";
    const label = active ? `${BLD}${node.label}${R}` : `\x1b[37m${node.label}${R}`;
    const arrow = isGroup(node) ? ` ${DIM}▸${R}` : "";
    const desc = `${DIM}${node.desc}${R}`;
    menuLines.push(`${pointer} ${padRight(label, 10)}${arrow} ${desc}`);
  }

  if (end < items.length) {
    menuLines.push(`  ${DIM}▼${R}`);
  }

  // 좌: 아트, 우: 메뉴 병합
  const artLines = artToLines(art);
  const artWidth = artLines.length > 0
    ? Math.max(...artLines.map((l) => visualWidth(l)))
    : 20;

  const rows = Math.max(artLines.length, menuLines.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = padRight(artLines[i] ?? "", artWidth);
    const right = menuLines[i] ?? "";
    merged.push(`  ${left}${ART_GAP}${right}`);
  }

  // 하단 안내
  const hint = breadcrumb.length > 0
    ? `${DIM}↑↓ 이동   Enter 선택   Esc 뒤로${R}`
    : `${DIM}↑↓ 이동   Enter 선택${R}`;

  const lines = [
    "",
    ...headerLines,
    "",
    `  ${BLD}P O K E L O G${R}`,
    `  ${DIM}${"─".repeat(52)}${R}`,
    `  ${hint}`,
    "",
    ...merged,
    "",
  ];

  if (message) {
    lines.push(`  ${message}`, "");
  }

  return lines;
}

// ── 명령 실행 ────────────────────────────────────────────────────

async function executeCommand(cmd: string): Promise<"continue" | "quit"> {
  await resetScreen(cmd);

  switch (cmd) {
    case "join": {
      const url = await inputFrame("서버 URL을 입력하세요:");
      if (url) await joinCommand(url);
      break;
    }
    case "servers":    await serversCommand(); break;
    case "leave":      await leaveCommand(); break;
    case "status":     await statusCommand(); break;
    case "encounters": await eventsCommand(); break;
    case "party":      await partyCommand(); break;
    case "pokedex":    await pokedexCommand(); break;
    case "inventory":  await inventoryCommand(); break;
    case "trade":      await tradeCommand(); break;
    case "evolutions": await evolutionsCommand(); break;
    case "heal":       await healCommand(); break;
    case "egg":        await eggCommand(); break;
    case "shop":       await shopCommand(); break;
    case "storage":    await storageCommand(); break;
    case "ranking":    await rankingCommand("exp"); break;
    case "history":    await historyCommand(); break;
    case "nickname":   await nicknameCommand(); break;
    case "login":      await loginCommand(); break;
    case "logout":     await logoutCommand(); break;
    case "register":   await registerCommand(); break;
    case "connect":    await connectCommand(); break;
    case "debug":      await debugCommand(); break;
    case "quit":
    case "exit":
      return "quit";
    default:
      break;
  }

  return "continue";
}

// ── 메인 루프 ────────────────────────────────────────────────────

export async function interactiveMode() {
  enterAltScreen();

  const cleanup = () => leaveAltScreen();
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  let loggedIn = !!(await getToken());
  let message = "";
  let lineCount = 0;
  let first = true;

  // 메뉴 스택: [{ items, cursor, scroll }]
  type MenuFrame = { items: MenuNode[]; cursor: number; scroll: number; title?: string };
  const menuStack: MenuFrame[] = [];

  function currentFrame(): MenuFrame {
    return menuStack[menuStack.length - 1];
  }

  function pushMenu(items: MenuNode[], title: string) {
    menuStack.push({ items, cursor: 0, scroll: 0, title });
    first = true;
  }

  function popMenu() {
    if (menuStack.length > 1) {
      menuStack.pop();
      first = true;
    }
  }

  function getBreadcrumb(): string[] {
    return menuStack.slice(1).map((f) => f.title ?? "").filter(Boolean);
  }

  while (true) {
    // 상태 갱신
    invalidateHeaderCache();
    const headerData = await fetchHeaderData();
    const hasServer = !!(await getCurrentServer());

    const headerLines = buildHeaderLines(
      headerData.serverName,
      headerData.nickname,
      headerData.region,
      headerData.pendingEvents,
      headerData.points,
      headerData.leadPokemon,
      headerData.leadLevel,
      headerData.online,
    );

    // 아트
    const artSpecies = loggedIn && headerData.leadPokemon
      ? headerData.leadPokemon
      : "ho-oh";
    const art = await fetchArt(artSpecies);

    // 루트 메뉴 빌드 (상태 변경 시 갱신)
    const rootItems = filterMenu(MENU_TREE, loggedIn, hasServer);
    if (menuStack.length === 0) {
      menuStack.push({ items: rootItems, cursor: 0, scroll: 0 });
    } else {
      // 루트 메뉴 항목 갱신 (로그인/서버 상태 변경 반영)
      menuStack[0].items = rootItems;
    }

    enterRaw();

    let needRefresh = false;
    while (!needRefresh) {
      const frame = currentFrame();
      // 커서 범위 보정
      frame.cursor = Math.min(frame.cursor, Math.max(0, frame.items.length - 1));
      // 스크롤 보정
      if (frame.cursor < frame.scroll) frame.scroll = frame.cursor;
      if (frame.cursor >= frame.scroll + VISIBLE_ITEMS) frame.scroll = frame.cursor - VISIBLE_ITEMS + 1;

      const lines = buildMenuLines(
        frame.items, frame.cursor, frame.scroll,
        getBreadcrumb(), art, headerLines, message,
      );
      lineCount = redraw(lines, lineCount, first);
      first = false;
      message = "";

      const key = await waitKey();

      if (key === "\x03") {
        process.stdout.write("\x1b[?25h");
        leaveAltScreen();
        process.exit(0);
      }

      if (key === "\x1b[A") {
        if (frame.cursor > 0) frame.cursor--;
        continue;
      }

      if (key === "\x1b[B") {
        if (frame.cursor < frame.items.length - 1) frame.cursor++;
        continue;
      }

      if (key === "\x1b" || key === "q") {
        if (menuStack.length > 1) {
          popMenu();
        }
        continue;
      }

      if (key !== "\r") continue;

      const selected = frame.items[frame.cursor];
      if (!selected) continue;

      if (isGroup(selected)) {
        // 서브메뉴로 진입 — 뒤로 항목 추가
        const backItem: MenuLeaf = { label: "뒤로", cmd: "__back__", desc: "" };
        const subItems: MenuNode[] = [
          ...filterMenu(selected.children, loggedIn, hasServer),
          backItem,
        ];
        pushMenu(subItems, selected.label);
        continue;
      }

      // 뒤로
      if (selected.cmd === "__back__") {
        popMenu();
        continue;
      }

      // 명령 실행
      process.stdout.write("\x1b[?25h");

      const result = await executeCommand(selected.cmd);
      if (result === "quit") {
        leaveAltScreen();
        return;
      }

      // 로그인 상태 갱신
      if (selected.cmd === "login" || selected.cmd === "register") {
        loggedIn = !!(await getToken());
      }
      if (selected.cmd === "logout") {
        loggedIn = false;
      }

      // 메뉴로 돌아올 때 — 루트로 복귀, 전체 새로 그리기
      menuStack.length = 0;
      first = true;
      needRefresh = true;
    }
  }
}
