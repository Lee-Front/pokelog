import { getServers, getCurrentServer, switchServer } from "../config.js";
import { rawSelect, separator } from "../ui/prompts.js";

export async function serversCommand() {
  const servers = await getServers();
  const current = await getCurrentServer();

  if (servers.length === 0) {
    console.log("  참가한 서버가 없습니다.");
    console.log("  join <url> 로 서버에 참가하세요.");
    return;
  }

  const DIM = "\x1b[90m";
  const CYN = "\x1b[36m";
  const YEL = "\x1b[33m";
  const BLD = "\x1b[1m";
  const R   = "\x1b[0m";

  const items: Array<{ name: string; value: string } | { separator: string }> = [];

  for (const s of servers) {
    const isCurrent = s.id === current?.id;
    const marker = isCurrent ? ` ${YEL}◀ 현재${R}` : "";
    const nameColor = isCurrent ? `${CYN}${BLD}` : "";
    const name = `  ${nameColor}${s.name.padEnd(12)}${R} ${DIM}${s.displayName.padEnd(18)}${R} ${DIM}${s.url}${R}${marker}`;
    items.push({ name, value: s.id });
  }

  items.push(separator(" "));
  items.push({ name: "← 닫기", value: "__close__" });

  const result = await rawSelect("서버 목록  ↑↓ 선택  Enter 전환  Esc 닫기", items, {
    pageSize: 20,
    default: current?.id,
  });

  if (!result || result === "__close__") return;

  if (result === current?.id) {
    console.log(`  이미 ${current.name} 서버에 접속 중입니다.`);
    return;
  }

  const switched = await switchServer(result);
  if (switched) {
    console.log(`  서버 전환 완료: ${BLD}${switched.displayName}${R} (${switched.name})`);
  }
}
