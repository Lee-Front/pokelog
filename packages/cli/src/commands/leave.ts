import { getServers, getCurrentServer, removeServer } from "../config.js";
import { rawSelect, separator } from "../ui/prompts.js";

export async function leaveCommand() {
  const servers = await getServers();
  const current = await getCurrentServer();

  if (servers.length === 0) {
    console.log("  참가한 서버가 없습니다.");
    return;
  }

  const DIM = "\x1b[90m";
  const RED = "\x1b[31m";
  const YEL = "\x1b[33m";
  const BLD = "\x1b[1m";
  const R   = "\x1b[0m";

  const items: Array<{ name: string; value: string } | { separator: string }> = [];

  for (const s of servers) {
    const isCurrent = s.id === current?.id;
    const marker = isCurrent ? ` ${YEL}◀ 현재${R}` : "";
    const name = `  ${s.name.padEnd(12)} ${DIM}${s.displayName.padEnd(18)}${R} ${DIM}${s.url}${R}${marker}`;
    items.push({ name, value: s.id });
  }

  items.push(separator(" "));
  items.push({ name: "← 닫기", value: "__close__" });

  const result = await rawSelect("나갈 서버 선택  ↑↓ 선택  Enter 확인  Esc 닫기", items, {
    pageSize: 20,
  });

  if (!result || result === "__close__") return;

  const target = servers.find((s) => s.id === result);
  if (!target) return;

  // 확인
  const confirmItems = [
    { name: `  ${RED}${BLD}예${R} — ${target.name} 서버에서 나가기`, value: "yes" as const },
    { name: `  아니오`, value: "no" as const },
  ];
  const ok = await rawSelect(`${RED}${BLD}${target.name}${R} 서버에서 나가시겠습니까?`, confirmItems);

  if (ok !== "yes") return;

  const removed = await removeServer(result);
  if (removed) {
    console.log(`  ${target.name} 서버에서 나갔습니다.`);
  }
}
