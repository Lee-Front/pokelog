import { getServers, getCurrentServer } from "../config.js";

export async function serversCommand() {
  const servers = await getServers();
  const current = await getCurrentServer();

  if (servers.length === 0) {
    console.log("참가한 서버가 없습니다.");
    console.log("  pokelog join <url> 로 서버에 참가하세요.");
    return;
  }

  console.log("  등록된 서버 목록");
  console.log("  " + "─".repeat(40));
  for (const s of servers) {
    const marker = s.id === current?.id ? " ◀ 현재" : "";
    console.log(`  ${s.name.padEnd(15)} ${s.displayName.padEnd(20)} ${s.url}${marker}`);
  }
}
