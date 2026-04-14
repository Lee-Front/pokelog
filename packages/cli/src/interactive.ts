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
import { getCurrentServer, getCurrentServerName, getToken, hasNoServers } from "./config.js";
import { BLD, CYN, DIM, GRN, R, RED, YEL } from "./ui/colors.js";
import { fetchArt, fetchHeaderData, invalidateHeaderCache } from "./ui/display.js";
import { enterRaw, waitKey } from "./ui/raw-mode.js";
import { enterAltScreen, leaveAltScreen, redraw, inputFrame, resetScreen } from "./ui/screen.js";
import { artToLines, padRight } from "./ui/text.js";

// ── 메뉴 정의 ───────────────────────────────────────────────────

type MenuItem = {
  label: string;
  cmd: string;
  desc: string;
  auth?: boolean;     // 로그인 필요
  server?: boolean;   // 서버 연결 필요
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

const MENU_SECTIONS: MenuSection[] = [
  {
    title: "Game",
    items: [
      { label: "상태",     cmd: "status",      desc: "현재 상태 보기",       auth: true, server: true },
      { label: "야생",     cmd: "encounters",  desc: "야생 이벤트 보기",     auth: true, server: true },
      { label: "파티",     cmd: "party",       desc: "파티 보기",            auth: true, server: true },
      { label: "도감",     cmd: "pokedex",     desc: "도감 보기",            auth: true, server: true },
      { label: "가방",     cmd: "inventory",   desc: "인벤토리 보기",        auth: true, server: true },
      { label: "회복",     cmd: "heal",        desc: "파티 회복",            auth: true, server: true },
      { label: "알",       cmd: "egg",         desc: "알 구매 / 부화",       auth: true, server: true },
      { label: "상점",     cmd: "shop",        desc: "상점 열기",            auth: true, server: true },
      { label: "보관함",   cmd: "storage",     desc: "보관함 보기",          auth: true, server: true },
      { label: "랭킹",     cmd: "ranking",     desc: "랭킹 보기",           auth: true, server: true },
      { label: "이력",     cmd: "history",     desc: "소스별 적립 이력 보기", auth: true, server: true },
    ],
  },
  {
    title: "Server",
    items: [
      { label: "서버 참가",  cmd: "join",    desc: "서버 참가" },
      { label: "서버 목록",  cmd: "servers", desc: "서버 목록 보기" },
      { label: "서버 나가기", cmd: "leave",  desc: "현재 서버 나가기", server: true },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "회원가입",   cmd: "register",  desc: "회원가입" },
      { label: "로그인",     cmd: "login",     desc: "로그인" },
      { label: "로그아웃",   cmd: "logout",    desc: "로그아웃",     auth: true },
      { label: "닉네임",     cmd: "nickname",  desc: "닉네임 변경",  auth: true },
      { label: "연동",       cmd: "connect",   desc: "연동 관리",    auth: true },
      { label: "디버그",     cmd: "debug",     desc: "디버그 메뉴",  auth: true },
    ],
  },
  {
    title: "System",
    items: [
      { label: "종료",  cmd: "quit", desc: "프로그램 종료" },
    ],
  },
];

// ── 전체 항목 평탄화 (separator 포함) ────────────────────────────

type FlatEntry =
  | { type: "separator"; title: string }
  | { type: "item"; item: MenuItem; sectionIdx: number; itemIdx: number };

function buildFlatMenu(loggedIn: boolean, hasServer: boolean): FlatEntry[] {
  const flat: FlatEntry[] = [];
  for (let s = 0; s < MENU_SECTIONS.length; s++) {
    const section = MENU_SECTIONS[s];
    const visibleItems = section.items.filter((item) => {
      if (item.auth && !loggedIn) return false;
      if (item.server && !hasServer) return false;
      return true;
    });
    if (visibleItems.length === 0) continue;
    flat.push({ type: "separator", title: section.title });
    for (let i = 0; i < visibleItems.length; i++) {
      flat.push({ type: "item", item: visibleItems[i], sectionIdx: s, itemIdx: i });
    }
  }
  return flat;
}

function getSelectableIndices(flat: FlatEntry[]): number[] {
  return flat
    .map((entry, idx) => (entry.type === "item" ? idx : -1))
    .filter((idx) => idx >= 0);
}

// ── 화면 빌드 ────────────────────────────────────────────────────

const MENU_W = 32;
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
  flat: FlatEntry[],
  selectableIndices: number[],
  cursorIdx: number,
  art: string | null,
  headerLines: string[],
  message: string,
): string[] {
  const cursor = selectableIndices[cursorIdx];
  const menuLines: string[] = [];

  for (let i = 0; i < flat.length; i++) {
    const entry = flat[i];
    if (entry.type === "separator") {
      if (menuLines.length > 0) menuLines.push("");
      menuLines.push(`${CYN}${BLD}── ${entry.title} ──${R}`);
    } else {
      const active = i === cursor;
      const pointer = active ? `${YEL}>${R}` : " ";
      const label = active
        ? `${BLD}${entry.item.label}${R}`
        : entry.item.label;
      const desc = `${DIM}${entry.item.desc}${R}`;
      menuLines.push(`${pointer} ${padRight(label, 10)} ${desc}`);
    }
  }

  // 좌측: 아트, 우측: 메뉴
  const artLines = artToLines(art);
  const artWidth = Math.max(0, ...artLines.map((l) => {
    let w = 0;
    for (const ch of l.replace(/\x1b\[[0-9;]*m/g, "")) {
      const c = ch.codePointAt(0) ?? 0;
      w += (c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
           (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) ||
           (c >= 0xFF01 && c <= 0xFF60) ? 2 : 1;
    }
    return w;
  }), 20);

  const rows = Math.max(artLines.length, menuLines.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = padRight(artLines[i] ?? "", artWidth);
    const right = menuLines[i] ?? "";
    merged.push(`  ${left}${ART_GAP}${right}`);
  }

  const lines = [
    "",
    ...headerLines,
    "",
    `  ${BLD}P O K E L O G${R}`,
    `  ${DIM}${"─".repeat(52)}${R}`,
    `  ${DIM}↑↓ 이동   Enter 선택${R}`,
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

async function executeCommand(cmd: string, args: string[]): Promise<"continue" | "quit"> {
  await resetScreen(cmd);

  switch (cmd) {
    case "join":
      if (args[0]) await joinCommand(args[0]);
      else {
        const url = await inputFrame("서버 URL을 입력하세요:");
        if (url) await joinCommand(url);
      }
      break;
    case "servers":   await serversCommand(); break;
    case "leave":     await leaveCommand(); break;
    case "status":    await statusCommand(); break;
    case "encounters": await eventsCommand(); break;
    case "party":     await partyCommand(); break;
    case "pokedex":   await pokedexCommand(); break;
    case "inventory": await inventoryCommand(); break;
    case "trade":     await tradeCommand(); break;
    case "region":    await regionCommand(args[0]); break;
    case "evolutions": await evolutionsCommand(); break;
    case "heal":      await healCommand(); break;
    case "egg":       await eggCommand(); break;
    case "shop":      await shopCommand(); break;
    case "storage":   await storageCommand(); break;
    case "ranking":   await rankingCommand(args[0] || "exp"); break;
    case "history":   await historyCommand(); break;
    case "nickname":  await nicknameCommand(args[0]); break;
    case "login":     await loginCommand(); break;
    case "logout":    await logoutCommand(); break;
    case "register":  await registerCommand(); break;
    case "connect":   await connectCommand(); break;
    case "debug":     await debugCommand(); break;
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
  let cursorIdx = 0;

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

    // 아트: 로그인 시 리드 포켓몬, 아닐 때 ho-oh
    const artSpecies = loggedIn && headerData.leadPokemon
      ? headerData.leadPokemon
      : "ho-oh";
    const art = await fetchArt(artSpecies);

    // 메뉴 빌드
    const flat = buildFlatMenu(loggedIn, hasServer);
    const selectableIndices = getSelectableIndices(flat);
    if (cursorIdx >= selectableIndices.length) {
      cursorIdx = 0;
    }

    enterRaw();

    // 내부 키 루프 (상태가 바뀌지 않는 동안)
    let needRefresh = false;
    while (!needRefresh) {
      const lines = buildMenuLines(flat, selectableIndices, cursorIdx, art, headerLines, message);
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
        if (cursorIdx > 0) cursorIdx--;
        continue;
      }

      if (key === "\x1b[B") {
        if (cursorIdx < selectableIndices.length - 1) cursorIdx++;
        continue;
      }

      if (key !== "\r") continue;

      // 선택된 항목 실행
      const flatIdx = selectableIndices[cursorIdx];
      const entry = flat[flatIdx];
      if (!entry || entry.type !== "item") continue;

      process.stdout.write("\x1b[?25h");

      const result = await executeCommand(entry.item.cmd, []);
      if (result === "quit") {
        leaveAltScreen();
        return;
      }

      // 로그인 상태 갱신
      if (entry.item.cmd === "login" || entry.item.cmd === "register") {
        loggedIn = !!(await getToken());
      }
      if (entry.item.cmd === "logout") {
        loggedIn = false;
      }

      // 메뉴로 돌아올 때 전체 새로 그리기
      first = true;
      needRefresh = true;
    }
  }
}
